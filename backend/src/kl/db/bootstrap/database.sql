-- KL · creación de la base (superusuario del clúster efímero). Terraform hace lo equivalente en G2.
-- El nombre lo fija el fingerprint (database=beeside_kl); el dueño es kl_owner (Contratos de seguridad §8.1).
CREATE DATABASE beeside_kl OWNER kl_owner;
