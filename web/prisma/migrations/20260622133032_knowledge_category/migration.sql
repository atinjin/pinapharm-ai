-- CreateTable
CREATE TABLE "KnowledgeCategory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCategory_name_key" ON "KnowledgeCategory"("name");

-- 보호 카테고리 미분류 시드
INSERT INTO "KnowledgeCategory" ("name", "displayOrder", "createdAt", "updatedAt")
VALUES ('미분류', 9999, datetime('now'), datetime('now'));
