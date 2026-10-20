import { KlTx } from "../db/attested-tx";
import { FontFamily, loadAssets } from "./render/compose";

/**
 * Manifiesto de edición: lo que queda congelado al enviar la edición a aprobación. Las entradas (versiones fijadas, enlaces vigentes,
 * huellas de bloques fijos) las calcula la base (`kl.manifest_inputs`) y `kl.submit_edition` las vuelve a verificar; el generador añade
 * solo el tema y las fuentes (con la huella de cada archivo empaquetado).
 */
export async function buildManifest(tx: KlTx, editionId: string, family: FontFamily): Promise<Record<string, unknown>> {
  const inputs = (await tx.query<{ m: Record<string, unknown> }>("SELECT kl.manifest_inputs($1) AS m", [editionId])).rows[0]?.m ?? {};
  return { ...inputs, fonts: { family, files: loadAssets(family).fontFiles } };
}

export async function submitEdition(tx: KlTx, editionId: string, family: FontFamily): Promise<string> {
  const manifest = await buildManifest(tx, editionId, family);
  return (await tx.query<{ s: string }>("SELECT kl.submit_edition($1, $2::jsonb) AS s", [editionId, JSON.stringify(manifest)])).rows[0]?.s as string;
}
