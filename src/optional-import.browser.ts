/** Edge bundles never contain filesystem drivers or opaque module imports. */
export async function optionalImport(specifier: string): Promise<unknown> {
  throw new Error(
    `Optional module "${specifier}" requires explicit injection in edge runtimes.`,
  );
}
