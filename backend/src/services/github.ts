// Layer 4: GitHub Repository Ingestion
import { ingestDocument } from "./documents";
import type { GitHubIngestRequest, GitHubIngestResult } from "../../../shared/types";

interface GitHubFile {
  name: string;
  path: string;
  download_url: string | null;
  type: "file" | "dir";
}

interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
  url: string;
}

/**
 * Parse GitHub repo URL to extract owner and repo name
 */
function parseGitHubUrl(repoUrl: string): { owner: string; repo: string } | null {
  // Support formats:
  // - https://github.com/owner/repo
  // - https://github.com/owner/repo.git
  // - github.com/owner/repo
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Fetch all files from a GitHub repository using the Git Trees API
 */
async function fetchRepoFiles(
  owner: string,
  repo: string,
  branch: string = "main",
  path: string = "",
  fileExtensions: string[] = [".md", ".txt"],
  maxFiles: number = 100
): Promise<GitHubFile[]> {
  const baseUrl = `https://api.github.com`;

  // First, get the SHA of the branch
  const branchUrl = `${baseUrl}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
  const branchRes = await fetch(branchUrl);

  if (!branchRes.ok) {
    throw new Error(`Failed to fetch branch ${branch}: ${branchRes.statusText}`);
  }

  const branchData = await branchRes.json();
  const commitSha = branchData.object.sha;

  // Get the tree recursively
  const treeUrl = `${baseUrl}/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`;
  const treeRes = await fetch(treeUrl);

  if (!treeRes.ok) {
    throw new Error(`Failed to fetch repository tree: ${treeRes.statusText}`);
  }

  const treeData = await treeRes.json();
  const files: GitHubFile[] = [];

  for (const item of treeData.tree as GitHubTreeItem[]) {
    if (item.type !== "blob") continue; // Skip directories

    // Filter by path prefix if specified
    if (path && !item.path.startsWith(path)) continue;

    // Filter by file extension
    const hasMatchingExtension = fileExtensions.some(ext =>
      item.path.toLowerCase().endsWith(ext.toLowerCase())
    );

    if (!hasMatchingExtension) continue;

    // Build download URL
    const downloadUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;

    files.push({
      name: item.path.split("/").pop() || item.path,
      path: item.path,
      download_url: downloadUrl,
      type: "file"
    });

    if (files.length >= maxFiles) break;
  }

  return files;
}

/**
 * Fetch file content from GitHub raw URL
 */
async function fetchFileContent(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }
  return await response.text();
}

/**
 * Ingest a GitHub repository
 */
export async function ingestGitHubRepo(
  request: GitHubIngestRequest
): Promise<GitHubIngestResult> {
  const {
    repoUrl,
    branch = "main",
    path = "",
    fileExtensions = [".md", ".txt"],
    maxFiles = 100
  } = request;

  // Parse the GitHub URL
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    throw new Error("Invalid GitHub URL. Expected format: https://github.com/owner/repo");
  }

  const { owner, repo } = parsed;
  const errors: Array<{ file: string; error: string }> = [];
  let documentsCreated = 0;

  try {
    // Fetch all matching files
    const files = await fetchRepoFiles(owner, repo, branch, path, fileExtensions, maxFiles);

    if (files.length === 0) {
      return {
        success: true,
        repoUrl,
        filesProcessed: 0,
        documentsCreated: 0,
        errors: []
      };
    }

    // Process each file
    for (const file of files) {
      if (!file.download_url) {
        errors.push({ file: file.path, error: "No download URL available" });
        continue;
      }

      try {
        // Fetch file content
        const content = await fetchFileContent(file.download_url);

        // Generate title from file path (remove extension)
        const title = file.path.replace(/\.(md|txt|js|ts|py|java|go|rs)$/i, "");

        // Ingest the document
        await ingestDocument(content, title, `github:${owner}/${repo}/${file.path}`);
        documentsCreated++;
      } catch (error) {
        errors.push({
          file: file.path,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      success: errors.length === 0,
      repoUrl,
      filesProcessed: files.length,
      documentsCreated,
      errors
    };
  } catch (error) {
    throw new Error(
      `Failed to ingest GitHub repository: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
