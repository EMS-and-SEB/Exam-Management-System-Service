CREATE TABLE "StaffInvitation" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffInvitation_tokenHash_key" ON "StaffInvitation"("tokenHash");

ALTER TABLE "StaffInvitation"
ADD CONSTRAINT "StaffInvitation_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "StaffAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;