-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '{}',
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KnowledgeChunk" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "documentId" INTEGER,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "embedding" BLOB NOT NULL,
    "model" TEXT NOT NULL,
    "embeddingStale" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_KnowledgeChunk" ("embedding", "id", "kind", "metadata", "model", "refId", "text", "title", "updatedAt") SELECT "embedding", "id", "kind", "metadata", "model", "refId", "text", "title", "updatedAt" FROM "KnowledgeChunk";
DROP TABLE "KnowledgeChunk";
ALTER TABLE "new_KnowledgeChunk" RENAME TO "KnowledgeChunk";
CREATE INDEX "KnowledgeChunk_kind_idx" ON "KnowledgeChunk"("kind");
CREATE INDEX "KnowledgeChunk_documentId_idx" ON "KnowledgeChunk"("documentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
