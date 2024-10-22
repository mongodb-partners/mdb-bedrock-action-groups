import { MongoClient } from "mongodb";
import { VectorGeneratorFacade } from "../common/VectorGeneratorFacade";

const DB_NAME = process.env.DB_NAME ?? "knowledgebase";
const COL_CHUNKS = process.env.COL_CHUNKS ?? "kbChunks";

export class MongoDBHybridRetriever {
  mongodb: MongoClient;
  vectorSearchIndex: string;
  textSearchIndex: string;

  constructor(mongoClient: MongoClient, vectorSearchIndex: string, textSearchIndex: string) {
    this.mongodb = mongoClient;
    this.vectorSearchIndex = vectorSearchIndex;
    this.textSearchIndex = textSearchIndex;
  }

  /**
   * Performs a hybrid search using reciprocal-rank-fusion for the given text.
   * @param text The query text for hybrid search.
   * @param filters Additional filters to apply to the search.
   * @returns A Promise that resolves to a sorted array of ChunkData objects representing the search results.
   */
  async query(text: string, filters?: {[key: string]: any }) {
    const vecGenerator = new VectorGeneratorFacade();
    const vector = await vecGenerator.getVectorEmbeddings(text);
    return this.hybridSearch(text, vector, 10);
  }

  /**
     * Performs a hybrid search using reciprocal-rank-fusion for the given textQuery and vector.
     * @see https://www.mongodb.com/docs/atlas/atlas-vector-search/tutorials/reciprocal-rank-fusion/
     *
     * @param textQuery The query text for hybrid search.
     * @param query The query vector.
     * @param k The number of results to return.
     * @returns A Promise that resolves to an array of ExtractChunkData objects representing the search results.
     */
  async hybridSearch(textQuery: string, vector: number[], k: number, vectorWeight = 0.1, fullTextWeight = 0.9) {
    await this.assertIndexes();
    const aggregation = this.buildHybridSearchAggregation(textQuery, vector, k, vectorWeight, fullTextWeight);
    const debugAggregation = this.buildHybridSearchAggregation(textQuery, humanReadableVector(vector), k, vectorWeight, fullTextWeight);

    console.info({ mongodbAggregationPipeline: debugAggregation });

    const results = await this.mongodb.db(DB_NAME)
      .collection(COL_CHUNKS)
      .aggregate(aggregation)
      .toArray();

    return results;
  }

  /**
   * Builds a hybrid search aggregation leveraging reciprocal-rank-fusion for the
   * given textQuery and vector.
   * @see https://www.mongodb.com/docs/atlas/atlas-vector-search/tutorials/reciprocal-rank-fusion/
   *
   * @param textQuery The query text for hybrid search.
   * @param query The query vector.
   * @param k The number of results to return.
   * @returns A Promise that resolves to an array of ExtractChunkData objects representing the search results.
   */
  buildHybridSearchAggregation(textQuery: string, vector: Array<number|"...">, k: number, vectorWeight = 0.1, fullTextWeight = 0.9) {
    const query_object = [
      /**
       * Vector Search and Reciprocal-rank
       */
      {
        "$vectorSearch": {
          "index": this.vectorSearchIndex,
          "path": "embedding",
          "queryVector": vector,
          "numCandidates": k*10,
          "limit": k
        }
      },
      {
        "$group": {
          "_id": null,
          "docs": {"$push": "$$ROOT"}
        }
      },
      {
        "$unwind": {
        "path": "$docs",
        "includeArrayIndex": "rank"
        }
      },
      {
        "$addFields": {
          "_id": "$docs._id",
          "vs_score": {
            "$multiply": [
              vectorWeight, {
                "$divide": [
                  1.0, {
                    "$add": ["$rank", 60]
                  }
                ]
              }
            ]
          }
        }
      },
      /**
       * $unionWith starts another aggregation that will be fused
       * with the results at this stage.
       * @example
       *   $vectorSearch → [...] -↘
       *                            $unionWith -→ [...]
       *   $search ------→ [...] -↗
       */
      {
        "$unionWith": {
          "coll": COL_CHUNKS,
          "pipeline": [
            /**
             * FullText Search and Reciprocal-rank
             */
            {
              "$search": {
                "index": this.textSearchIndex,
                "text": {
                  "query": textQuery,
                  "path": "text"
                }
              }
            }, {
              "$limit": k
            }, {
              "$group": {
                "_id": null,
                "docs": {"$push": "$$ROOT"}
              }
            }, {
              "$unwind": {
                "path": "$docs",
                "includeArrayIndex": "rank"
              }
            }, {
              "$addFields": {
                "_id": "$docs._id",
                "fts_score": {
                  "$multiply": [
                    fullTextWeight, {
                      "$divide": [
                        1.0, {
                          "$add": ["$rank", 60]
                        }
                      ]
                    }
                  ]
                }
              }
            }
          ]
        }
      },
      /**
       * Reciprocal-rank-fusion
       * Fuse scores and make then available in the `vs_score`,
       * `fts_score` and `score` fields
       */
      {
        "$group": {
          "_id": "$_id",
          docs: {
            $first: "$docs",
          },
          "vs_score": {"$max": "$vs_score"},
          "fts_score": {"$max": "$fts_score"}
        }
      },
      {
        "$addFields": {
          "docs.vs_score": {"$ifNull": ["$vs_score", 0]},
          "docs.fts_score": {"$ifNull": ["$fts_score", 0]}
        }
      },
      {
        "$addFields": {
          "docs.score": {"$add": ["$docs.vs_score", "$docs.fts_score"]}
        }
      },
      /**
       * Bring results to root of results
       */
      {
        $replaceRoot: {newRoot: "$docs"}
      },
      {
        "$unset": "embedding"
      },
      /**
       * Sort by score and limit results
       */
      {
        "$sort": {"score": -1}
      },
      {
        "$limit": k
      }
    ];

    return query_object;
  }

  async assertIndexes() {

  }
}

/**
 * Returns a human-readable truncated version of the given vector
 * with only the first few numbers and then '...'
 * @example
 *   input:  [0.1234, 0.1234, 0.1234, 0.1234, 0.1234, 0.1234, 0.1234, 0.1234]
 *   output: [0.1234, 0.1234, 0.1234, 0.1234, '...']
 * @param vector The vector to make human-readable.
 * @returns A human-readable version of the given vector.
 */
const humanReadableVector: (vector: number[]) => Array<number|"..."> = (vector) =>
  [...vector.slice(0, 4), '...'];
