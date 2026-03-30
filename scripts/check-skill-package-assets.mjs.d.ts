export type DeclaredAssetKey = "skillDescriptor" | "readme";

export type DeclaredAsset = {
  key: DeclaredAssetKey;
  declaredPath: string;
  expectedRelativePath: string;
  resolvedPath: string;
};

export type ValidationResult = {
  repoRoot: string;
  packageDir: string;
  packageJsonPath: string;
  assets: DeclaredAsset[];
};

export function resolveDeclaredAsset(
  packageDir: string,
  metadata: unknown,
  key: DeclaredAssetKey
): DeclaredAsset;

export function validateSkillPackageAssets(repoRoot?: string): ValidationResult;

export function formatValidationSuccess(result: ValidationResult): string;
