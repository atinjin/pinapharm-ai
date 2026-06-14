-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HealthProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "ageBand" TEXT,
    "sex" TEXT,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "medications" TEXT NOT NULL DEFAULT '[]',
    "allergies" TEXT NOT NULL DEFAULT '[]',
    "pregnancy" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HealthProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_HealthProfile" ("ageBand", "allergies", "conditions", "customerId", "id", "medications", "notes", "pregnancy", "sex", "updatedAt") SELECT "ageBand", "allergies", "conditions", "customerId", "id", "medications", "notes", "pregnancy", "sex", "updatedAt" FROM "HealthProfile";
DROP TABLE "HealthProfile";
ALTER TABLE "new_HealthProfile" RENAME TO "HealthProfile";
CREATE UNIQUE INDEX "HealthProfile_customerId_key" ON "HealthProfile"("customerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Identity_customerId_idx" ON "Identity"("customerId");
