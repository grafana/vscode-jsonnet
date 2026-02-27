import { ExtensionContext, OutputChannel, window, workspace } from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { createHash } from 'crypto';
import {
  findChecksumAsset,
  findMatchingReleaseAsset,
  parseSha256Checksum,
  parseVersionFromOutput,
  ReleaseAsset,
} from './installUtils';

export type Component = 'languageServer' | 'debugger';

const ComponentDetails: Record<
  Component,
  {
    binaryName: string;
    displayName: string;
  }
> = {
  languageServer: {
    binaryName: 'jrsonnet-lsp',
    displayName: 'language server',
  },
  debugger: {
    binaryName: 'jsonnet-debugger',
    displayName: 'debugger',
  },
};

const execFileAsync = promisify(execFile);
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 15000;

export async function install(
  context: ExtensionContext,
  channel: OutputChannel,
  component: Component
): Promise<string | null> {
  const { binaryName, displayName } = ComponentDetails[component];
  let binPath: string = workspace.getConfiguration('jsonnet').get(`${component}.pathToBinary`);
  const isCustomBinPath = binPath !== undefined && binPath !== null && binPath !== '';
  if (!isCustomBinPath) {
    channel.appendLine(`Not using custom binary path. Using default path for ${component}`);
    binPath = path.join(context.globalStorageUri.fsPath, 'bin', binaryName);
    if (process.platform.toString() === 'win32') {
      binPath = `${binPath}.exe`;
    }
    const binDir = path.dirname(binPath);
    try {
      await fs.promises.mkdir(binDir, { recursive: true });
    } catch (e) {
      const msg = `Failed to create directory ${binDir}`;
      channel.appendLine(msg);
      channel.appendLine(e);
      window.showErrorMessage(msg);
      throw new Error(msg);
    }
  }

  const releaseRepository: string = workspace.getConfiguration('jsonnet').get(`${component}.releaseRepository`);

  const binPathExists = await fileExists(binPath);
  channel.appendLine(`Binary path is ${binPath} (exists: ${binPathExists})`);

  // Without auto-update, the process ends here.
  const enableAutoUpdate: boolean = workspace.getConfiguration('jsonnet').get(`${component}.enableAutoUpdate`);
  if (!enableAutoUpdate) {
    if (!binPathExists) {
      const msg = `The ${displayName} binary does not exist, please set either 'jsonnet.${component}.pathToBinary' or 'jsonnet.${component}.enableAutoUpdate'`;
      channel.appendLine(msg);
      window.showErrorMessage(msg);
      return null;
    }
    return binPath;
  }

  // Check for the latest release in Github
  const releaseUrl = `https://api.github.com/repos/${releaseRepository}/releases/latest`;
  channel.appendLine(`Auto-update is enabled. Fetching latest release from ${releaseUrl}`);

  let releaseData: { name?: string; tag_name?: string; assets?: ReleaseAsset[] } = {};
  let latestVersion = '';
  try {
    const body = await githubApiRequest(releaseUrl);
    releaseData = JSON.parse(body);
    latestVersion = releaseData.tag_name || releaseData.name || '';
    if (latestVersion.startsWith('v')) {
      latestVersion = latestVersion.substring(1);
    }
    if (!latestVersion) {
      throw new Error('Could not determine release version from GitHub API response');
    }
  } catch (e) {
    // If we already have a binary on disk, prefer continuing with it rather than failing activation.
    if (binPathExists) {
      const warnMsg = `Failed to fetch latest release from ${releaseUrl}. Continuing with the current binary.`;
      channel.appendLine(warnMsg);
      channel.appendLine(e);
      window.showWarningMessage(warnMsg);
      return binPath;
    }

    const msg = `Failed to fetch latest release from ${releaseUrl}`;
    channel.appendLine(msg);
    channel.appendLine(e);

    if (!isCustomBinPath) {
      window.showErrorMessage(msg);
      throw new Error(msg);
    }

    window.showWarningMessage(msg + '. Continuing with the current version.');
    return binPath;
  }
  channel.appendLine(`Latest release is ${latestVersion}`);

  // Check the current version
  let doUpdate = false;
  if (!binPathExists) {
    // The binary does not exist. Only install if the user says yes.
    const value = await window.showInformationMessage(
      `The ${displayName} does not seem to be installed. Do you wish to install the latest version?`,
      'Yes',
      'No'
    );
    if (value === 'No') {
      return null;
    }
    doUpdate = true;
  } else {
    // The binary exists
    try {
      // Check the version
      const result = await execFileAsync(binPath, ['--version'], { encoding: 'utf8' });
      const currentVersion = parseVersionFromOutput(String(result.stdout), binaryName);
      if (!currentVersion) {
        throw new Error('Invalid version string');
      }

      // Compare the versions and prompt the user if they are different
      channel.appendLine(`Current release is '${currentVersion}'`);
      if (currentVersion !== latestVersion) {
        const value = await window.showInformationMessage(
          `Current version (${currentVersion}) != latest (${latestVersion}). Do you wish to install the latest version?`,
          'Yes',
          'No'
        );
        doUpdate = value === 'Yes';
      }
    } catch (e) {
      // The binary is invalid, prompt the user to update
      const msg = `Failed to get current version from ${binPath}`;
      channel.appendLine(msg);
      channel.appendLine(e);

      const value = await window.showWarningMessage(`${msg}. Do you wish to install the latest version?`, 'Yes', 'No');
      doUpdate = value === 'Yes';
    }
  }

  // Update the binary (if specified by the user)
  if (doUpdate) {
    channel.appendLine(`Downloading latest release (${latestVersion}) to ${binPath}...`);

    let platform = process.platform.toString();
    const arch = {
      arm: 'armv7',
      arm64: 'arm64',
      x64: 'amd64',
    }[process.arch];
    if (!arch) {
      const msg = `Unsupported architecture '${process.arch}'`;
      channel.appendLine(msg);
      window.showErrorMessage(msg);
      throw new Error(msg);
    }
    let suffix = '';
    if (platform === 'win32') {
      platform = 'windows';
      suffix = '.exe';
    }

    const matchingAsset = findMatchingReleaseAsset(releaseData.assets ?? [], binaryName, platform, arch);
    const url =
      matchingAsset?.browser_download_url ||
      `https://github.com/${releaseRepository}/releases/download/v${latestVersion}/${binaryName}_${latestVersion}_${platform}_${arch}${suffix}`;
    channel.appendLine(`Downloading ${url}`);
    const downloadedAssetName = matchingAsset?.name || path.basename(new URL(url).pathname);

    try {
      await download(url, binPath);
      await verifySha256IfAvailable(releaseData.assets ?? [], downloadedAssetName, binPath, channel);
      await fs.promises.chmod(binPath, 0o755);
    } catch (e) {
      const msg = `Failed to download ${url} to ${binPath}`;
      channel.appendLine(msg);
      channel.appendLine(e);
      window.showErrorMessage(msg);
      throw new Error(msg);
    }

    channel.appendLine(`Successfully downloaded the ${displayName} version ${latestVersion}`);
    window.showInformationMessage(`Successfully installed the ${displayName} version ${latestVersion}`);
  } else {
    channel.appendLine(`Not updating the ${displayName}.`);
  }

  return binPath;
}

function download(uri: string, filename: string, redirects = 0): Promise<void> {
  if (redirects > MAX_REDIRECTS) {
    return Promise.reject(new Error(`too many redirects while downloading ${uri}`));
  }
  return new Promise((resolve, reject) => {
    const onError = function (e) {
      void fs.promises.unlink(filename).catch(() => undefined);
      reject(e);
    };
    const request = https
      .get(uri, { timeout: REQUEST_TIMEOUT_MS }, function (response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          const fileStream = fs.createWriteStream(filename);
          fileStream.on('error', onError);
          fileStream.on('close', resolve);
          response.pipe(fileStream);
        } else if (response.headers.location) {
          const redirected = new URL(response.headers.location, uri).toString();
          resolve(download(redirected, filename, redirects + 1));
        } else {
          reject(new Error(response.statusCode + ' ' + response.statusMessage));
        }
      })
      .on('error', onError);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
  });
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function verifySha256IfAvailable(
  assets: ReleaseAsset[],
  downloadedAssetName: string,
  downloadedPath: string,
  channel: OutputChannel
): Promise<void> {
  const checksumAsset = findChecksumAsset(assets, downloadedAssetName);
  if (!checksumAsset?.browser_download_url) {
    channel.appendLine(`No checksum asset found for ${downloadedAssetName}; skipping verification`);
    return;
  }

  const checksumFile = await githubApiRequest(checksumAsset.browser_download_url);
  const expected = parseSha256Checksum(checksumFile, downloadedAssetName);
  if (!expected) {
    throw new Error(`could not parse checksum for ${downloadedAssetName} from ${checksumAsset.name}`);
  }

  const actual = await sha256File(downloadedPath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`checksum mismatch for ${downloadedAssetName} ` + `(expected ${expected}, got ${actual})`);
  }
  channel.appendLine(`Verified sha256 checksum for ${downloadedAssetName}`);
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const file = await fs.promises.readFile(filePath);
  hash.update(file);
  return hash.digest('hex');
}

function githubApiRequest(
  url: string,
  options: https.RequestOptions = {},
  encoding: BufferEncoding = 'utf8',
  redirects = 0
): Promise<string> {
  if (redirects > MAX_REDIRECTS) {
    return Promise.reject(new Error(`too many redirects while requesting ${url}`));
  }
  if (options.headers === undefined) {
    options.headers = {};
  }
  options.headers['User-Agent'] = 'vscode-jsonnet';
  options.timeout = REQUEST_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const request = https
      .request(url, options, (res) => {
        if (
          (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) &&
          res.headers.location
        ) {
          // follow redirects
          const redirected = new URL(res.headers.location, url).toString();
          return resolve(githubApiRequest(redirected, options, encoding, redirects + 1));
        }
        if (res.statusCode !== 200) {
          return reject(res.statusMessage);
        }
        let body = '';
        res
          .setEncoding(encoding)
          .on('data', (data) => (body += data))
          .on('end', () => resolve(body));
      })
      .on('error', reject);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    request.end();
  });
}
