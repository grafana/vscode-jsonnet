export type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

export function parseVersionFromOutput(
  output: string,
  binaryName: string
): string | null {
  const firstLine = output.trim().split(/\r?\n/)[0];
  if (!firstLine) {
    return null;
  }

  const escapedBinaryName = binaryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefixedMatch = firstLine.match(
    new RegExp(`^${escapedBinaryName}(?:\\s+version)?\\s+(.+)$`, 'i')
  );
  if (prefixedMatch && prefixedMatch[1]) {
    return prefixedMatch[1].trim();
  }

  const plainVersionMatch = firstLine.match(/^v?\d+\.\d+\.\d+(?:[-+].+)?$/);
  if (plainVersionMatch) {
    return firstLine.trim().replace(/^v/, '');
  }

  return null;
}

export function findMatchingReleaseAsset(
  assets: ReleaseAsset[],
  binaryName: string,
  platform: string,
  arch: string
): ReleaseAsset | null {
  const platformAliases: Record<string, string[]> = {
    linux: ['linux'],
    darwin: ['darwin', 'macos', 'osx'],
    windows: ['windows', 'win32', 'win'],
  };
  const archAliases: Record<string, string[]> = {
    amd64: ['amd64', 'x86_64'],
    arm64: ['arm64', 'aarch64'],
    armv7: ['armv7', 'armv7l', 'arm'],
  };

  const platformTokens = platformAliases[platform] ?? [platform];
  const archTokens = archAliases[arch] ?? [arch];
  const binaryToken = binaryName.toLowerCase();

  const candidates = assets
    .filter((asset) => asset.name && asset.browser_download_url)
    .filter((asset) => {
      const name = asset.name!.toLowerCase();
      if (
        name.endsWith('.sha256') ||
        name.endsWith('.sig') ||
        name.endsWith('.asc') ||
        name.endsWith('.txt')
      ) {
        return false;
      }
      if (!name.includes(binaryToken)) {
        return false;
      }
      const matchesPlatform = platformTokens.some((token) => name.includes(token));
      const matchesArch = archTokens.some((token) => name.includes(token));
      return matchesPlatform && matchesArch;
    });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => a.name!.length - b.name!.length);
  return candidates[0];
}

export function findChecksumAsset(
  assets: ReleaseAsset[],
  downloadedAssetName: string
): ReleaseAsset | null {
  const normalized = downloadedAssetName.toLowerCase();
  const direct = assets.find(
    (asset) => asset.name?.toLowerCase() === `${normalized}.sha256`
  );
  if (direct) {
    return direct;
  }
  return (
    assets.find((asset) => {
      const name = asset.name?.toLowerCase();
      return Boolean(name && name.endsWith('.sha256') && name.includes(normalized));
    }) || null
  );
}

export function parseSha256Checksum(
  contents: string,
  expectedName: string
): string | null {
  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let firstHash: string | null = null;

  for (const line of lines) {
    const match = line.match(/^([0-9a-fA-F]{64})(?:\s+[* ]?(.+))?$/);
    if (!match) {
      continue;
    }
    const hash = match[1];
    const name = match[2]?.trim();
    if (!firstHash) {
      firstHash = hash;
    }
    if (name && name.endsWith(expectedName)) {
      return hash;
    }
    if (!name) {
      return hash;
    }
  }
  return firstHash;
}
