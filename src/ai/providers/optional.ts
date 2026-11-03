import { MissingDependencyError } from '../../errors.js';

/** Imports an optional peer dependency, turning "module not found" into an install hint. */
export async function importOptional<T>(specifier: string, feature: string): Promise<T> {
  try {
    return (await import(specifier)) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ERR_MODULE_NOT_FOUND') {
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]!;
      throw new MissingDependencyError(packageName, feature);
    }
    throw error;
  }
}
