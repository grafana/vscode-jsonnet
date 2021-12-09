import { ExtensionContext, OutputChannel, window, workspace } from "vscode";
import * as https from 'https';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as path from 'path';

export async function install(context: ExtensionContext, channel: OutputChannel): Promise<string> {
    let binPath: string = workspace.getConfiguration('jsonnet').get('languageServer.pathToBinary');
    const releaseRepository: string = workspace.getConfiguration('jsonnet').get('languageServer.releaseRepository');

    // If the binPath is undefined, use a default path
    const isCustomBinPath = (binPath !== undefined && binPath !== null && binPath !== '');
    if (!isCustomBinPath) {
        channel.appendLine(`Not using custom binary path. Using default path`);
        binPath = path.join(context.globalStorageUri.fsPath, 'bin', 'jsonnet-language-server');
        const binDir = path.dirname(binPath);
        try {
            fs.mkdirSync(binDir, { recursive: true });
        } catch (e) {
            const msg = `Failed to create directory ${binDir}`;
            channel.appendLine(msg);
            channel.appendLine(e);
            window.showErrorMessage(msg);
            throw new Error(msg);
        }
    }
    const binPathExists = fs.existsSync(binPath);
    channel.appendLine(`Binary path is ${binPath} (exists: ${binPathExists})`);


    // Without auto-update, the process ends here.
    const enableAutoUpdate: boolean = workspace.getConfiguration('jsonnet').get('languageServer.enableAutoUpdate');
    if (!enableAutoUpdate) {
        if (!binPathExists) {
            const msg = "The language server binary does not exist, please set either 'jsonnet.languageServer.pathToBinary' or 'jsonnet.languageServer.enableAutoUpdate'";
            channel.appendLine(msg);
            window.showErrorMessage(msg);
            throw new Error(msg);
        }
        return binPath;
    }




    // Check for the latest release in Github
    const releaseUrl = `https://api.github.com/repos/${releaseRepository}/releases/latest`;
    channel.appendLine(`Auto-update is enabled. Fetching latest release from ${releaseUrl}`);

    let releaseData: { name?: string } = {};
    let latestVersion = "";
    try {
        const body = await githubApiRequest(releaseUrl);
        releaseData = JSON.parse(body);
        latestVersion = releaseData.name;
        if (latestVersion.startsWith("v")) {
            latestVersion = latestVersion.substring(1);
        }
    } catch (e) {
        const msg = `Failed to fetch latest release from ${releaseUrl}`;
        channel.appendLine(msg);
        channel.appendLine(e);

        if (!isCustomBinPath) {
            window.showErrorMessage(msg);
            throw new Error(msg);
        }

        window.showWarningMessage(msg + ". Continuing with the current version.");
        return binPath;
    }
    channel.appendLine(`Latest release is ${latestVersion}`);


    // Check the current version
    let doUpdate = false;
    if (!binPathExists) {
        // The binary does not exist. Only install if the user says yes.
        const value = await window.showInformationMessage(`The language server does not seem to be installed. Do you wish to install the latest version?`, "Yes", "No");
        doUpdate = (value === "Yes");
    } else {
        // The binary exists
        try {
            // Check the version
            let currentVersion = "";
            const result = execFileSync(binPath, ["--version"]);
            const prefix = "jsonnet-language-server version ";
            if (result.toString().startsWith(prefix)) {
                currentVersion = result.toString().substring(prefix.length).trim();
            } else {
                throw new Error("Invalid version string");
            }

            // Compare the versions and prompt the user if they are different
            channel.appendLine(`Current release is '${currentVersion}'`);
            if (currentVersion !== latestVersion) {
                const value = await window.showInformationMessage(`Current version (${currentVersion}) != latest (${latestVersion}). Do you wish to install the latest version?`, "Yes", "No");
                doUpdate = (value === "Yes");
            }

        } catch (e) {
            // The binary is invalid, prompt the user to update
            const msg = `Failed to get current version from ${binPath}`;
            channel.appendLine(msg);
            channel.appendLine(e);

            const value = await window.showWarningMessage(`${msg}. Do you wish to install the latest version?`, "Yes", "No");
            doUpdate = (value === "Yes");
        }
    }

    // Update the binary (if specified by the user)
    if (doUpdate) {
        channel.appendLine(`Downloading latest release (${latestVersion}) to ${binPath}...`);

        let platform = process.platform.toString();
        const arch = {
            "arm": "armv7",
            "arm64": "arm64",
            "x64": "amd64",
        }[process.arch];
        let suffix = "";
        if (platform === 'win32') {
            platform = 'windows';
            suffix = '.exe';
        }

        const url = `https://github.com/${releaseRepository}/releases/download/v${latestVersion}/jsonnet-language-server_${latestVersion}_${platform}_${arch}${suffix}`;
        channel.appendLine(`Downloading ${url}`);

        try {
            await download(url, binPath);
            fs.chmodSync(binPath, 0o777);
        } catch (e) {
            const msg = `Failed to download ${url} to ${binPath}`;
            channel.appendLine(msg);
            channel.appendLine(e);
            window.showErrorMessage(msg);
            throw new Error(msg);
        }

        channel.appendLine(`Successfully downloaded the language server version ${latestVersion}`);
        window.showInformationMessage(`Successfully installed the language server version ${latestVersion}`);
    } else {
        channel.appendLine(`Not updating the language server.`);
    }

    return binPath;
}

function download(uri, filename) {
    return new Promise((resolve, reject) => {
        const onError = function (e) {
            fs.unlinkSync(filename);
            reject(e);
        };
        https.get(uri, function (response) {
            if (response.statusCode >= 200 && response.statusCode < 300) {
                const fileStream = fs.createWriteStream(filename);
                fileStream.on('error', onError);
                fileStream.on('close', resolve);
                response.pipe(fileStream);
            } else if (response.headers.location) {
                resolve(download(response.headers.location, filename));
            } else {
                reject(new Error(response.statusCode + ' ' + response.statusMessage));
            }
        }).on('error', onError);
    });
}

function githubApiRequest(url: string, options: https.RequestOptions = {}, encoding = 'utf8'): Promise<string> {
    if (options.headers === undefined) {
        options.headers = {};
    }
    options.headers['User-Agent'] = 'vscode-jsonnet';
    return new Promise((resolve, reject) => {
        https.request(url, options, res => {
            if (res.statusCode === 301 || res.statusCode === 302) { // follow redirects
                return resolve(githubApiRequest(res.headers.location, options, encoding));
            }
            if (res.statusCode !== 200) {
                return reject(res.statusMessage);
            }
            let body = '';
            res.setEncoding(encoding)
                .on('data', data => body += data)
                .on('end', () => resolve(body));
        })
            .on('error', reject)
            .end();
    });
}

