import sodium from "libsodium-wrappers";

// GitHub stores repo secrets encrypted with a libsodium "sealed box" to the
// repo's own public key: only GitHub can open it, we cannot read it back.
export async function sealSecret(publicKeyBase64: string, value: string): Promise<string> {
  await sodium.ready;
  const key = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), key);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}
