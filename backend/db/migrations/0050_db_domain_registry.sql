CREATE TABLE "db_domain_registry" (
	"table_name" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"discovery_privileges" text DEFAULT '' NOT NULL,
	CONSTRAINT "db_domain_registry_domain" CHECK ("db_domain_registry"."domain" IN ('DISCOVERY', 'PLATFORM', 'PRECISION')),
	CONSTRAINT "db_domain_registry_privileges" CHECK ("db_domain_registry"."discovery_privileges" ~ '^S?I?U?D?$'),
	CONSTRAINT "db_domain_registry_precision_closed" CHECK ("db_domain_registry"."domain" <> 'PRECISION' OR "db_domain_registry"."discovery_privileges" = '')
);
