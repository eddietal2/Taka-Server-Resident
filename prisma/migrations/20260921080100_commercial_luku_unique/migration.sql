-- The commercial profile could previously hold a meter another account already
-- had. NULLs are distinct in a Postgres unique index, so businesses that
-- registered without a meter are unaffected.
CREATE UNIQUE INDEX "CommercialProfile_lukuMeter_key" ON "CommercialProfile"("lukuMeter");
