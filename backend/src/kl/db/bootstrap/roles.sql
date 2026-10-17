-- KL · bootstrap de roles y base para desarrollo local y CI (CR-KL-002 §8, §10).
-- Lo ejecuta un superusuario del clúster EFÍMERO. En entornos compartidos lo hace Terraform (G2); este
-- archivo es la referencia de lo que Plataforma debe aprovisionar. No es una migración: KL-NNNN no crea roles.
-- Parámetros psql: nada. Las contraseñas las fija quien llama (ALTER ROLE ... PASSWORD) fuera de este archivo.

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['kl_owner','kl_app','kl_reader_precision','kl_agent','kl_knowledge'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', r);
    END IF;
  END LOOP;
END $$;

-- Límite de conexiones por rol (pools pequeños en dev, CR-KL-002 §10: backend 3 + 3, kl-worker 2 + 2, kl-migrate 1).
ALTER ROLE kl_owner CONNECTION LIMIT 4;
ALTER ROLE kl_app CONNECTION LIMIT 8;
ALTER ROLE kl_reader_precision CONNECTION LIMIT 8;
ALTER ROLE kl_agent CONNECTION LIMIT 4;
ALTER ROLE kl_knowledge CONNECTION LIMIT 4;

-- Tiempos por rol (§8.2): lector de Precision 1 s; kl_app 30 s con transacciones ociosas acotadas (§4.3).
ALTER ROLE kl_reader_precision SET statement_timeout = '1s';
ALTER ROLE kl_app SET statement_timeout = '30s';
ALTER ROLE kl_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE kl_agent SET statement_timeout = '60s';
ALTER ROLE kl_knowledge SET statement_timeout = '60s';
ALTER ROLE kl_agent SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE kl_knowledge SET idle_in_transaction_session_timeout = '60s';
