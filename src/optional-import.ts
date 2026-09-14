/** Only the server build can discover installed runtime modules. */
export async function optionalImport(specifier: string): Promise<unknown> {
  return import(/* webpackIgnore: true */ specifier);
}
