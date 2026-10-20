-- Размер документа и счётчики квоты аккаунта (D-312). Для уже сохранённых документов размер — длина jsonb::text:
-- с пробелами после «:» и «,» она чуть больше JSON.stringify, квота считается с небольшим запасом.
ALTER TABLE "user_docs" ADD COLUMN "size" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "doc_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "doc_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "user_docs" SET "size" = octet_length("data"::text) WHERE "data" IS NOT NULL;--> statement-breakpoint
UPDATE "users" SET "doc_count" = s."n", "doc_bytes" = s."b"
FROM (SELECT "user_id", count(*) AS "n", sum("size") AS "b" FROM "user_docs" GROUP BY "user_id") AS s
WHERE "users"."id" = s."user_id";
