-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "embedding" BLOB NOT NULL,
    "model" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_kind_idx" ON "KnowledgeChunk"("kind");
