# Migrations

`20250902000000_init.sql` is the whole schema — ten tables and two views. It is the
same file as `db/schema.sql`; that copy stays because it is what the SQL Editor path
uses, and this copy is what the GitHub integration applies on a merge to `main`.

Every statement is `create ... if not exists` or `create or replace`, so re-running a
migration is safe and the integration re-applying it on a later merge changes nothing.

**Migrations create the tables. They do not load the data** — 15,144 telemetry rows do
not belong in a migration. After the schema is applied, load with:

```bash
export DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
python db/load_supabase.py
```
