/**
 * Search predicates written to match the indexes in 0001_init.sql exactly, so Postgres
 * can use them: users_name_trgm_idx is on (display_name || ' ' || username || ' ' ||
 * email), courses_title_trgm_idx on title, and courses.search is a weighted tsvector.
 * Never ILIKE an unindexed column.
 */
import { sql, type Expression, type SqlBool } from "kysely";
import { likeContains, prefixTsQuery } from "../domain/search-text";

/** Matches users_name_trgm_idx. `alias` is the users table alias. */
export function userNameLike(alias: string, q: string): Expression<SqlBool> {
  return sql<boolean>`(${sql.ref(`${alias}.display_name`)} || ' ' || ${sql.ref(`${alias}.username`)}::text || ' ' || ${sql.ref(`${alias}.email`)}::text) ILIKE ${likeContains(q)}`;
}

/** tsvector prefix match on a `search` column; false when the query has no words. */
export function tsMatches(searchColumn: string, q: string): Expression<SqlBool> {
  const ts = prefixTsQuery(q);
  if (!ts) return sql<boolean>`false`;
  return sql<boolean>`${sql.ref(searchColumn)} @@ to_tsquery('simple', ${ts})`;
}

/** Relevance of a `search` column for a query (0 when the query has no words). */
export function tsRank(searchColumn: string, q: string): Expression<number> {
  const ts = prefixTsQuery(q);
  if (!ts) return sql<number>`0`;
  return sql<number>`ts_rank_cd(${sql.ref(searchColumn)}, to_tsquery('simple', ${ts}))`;
}

/** Matches courses_title_trgm_idx. */
export function titleLike(column: string, q: string): Expression<SqlBool> {
  return sql<boolean>`${sql.ref(column)} ILIKE ${likeContains(q)}`;
}
