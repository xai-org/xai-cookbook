import { spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";

// Opens a Cloudflare quick tunnel, which gives a local port a public HTTPS URL without an account. The
// tunnel stays open until close() is called or this process exits.
export async function openTunnel(port: number): Promise<{ url: string; close: () => void }> {
  const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "ignore", "pipe"] });
  const close = () => child.kill();
  process.once("exit", close);
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let log = "";
      child.once("error", (error) => reject(new Error(`Couldn't start cloudflared: ${error.message}. Install it, or set MCP_PUBLIC_URL.`)));
      child.once("exit", (code) => reject(new Error(`cloudflared exited with code ${code}`)));
      child.stderr.on("data", function read(chunk) {
        log += chunk;
        const url = log.match(/https:\/\/[\w-]+\.trycloudflare\.com/)?.[0];
        if (!url || !log.includes("Registered tunnel connection")) return;
        // The pipe keeps flowing without a listener, so cloudflared's later logs are dropped, not kept.
        child.stderr.off("data", read);
        resolve(url);
      });
    });
    await waitForDns(new URL(url).hostname);
    return { url, close };
  } catch (error) {
    close();
    throw error;
  }
}

// SpaceXAI can't reach the tunnel until its hostname is in public DNS, a second or two after cloudflared
// connects. Asking a public resolver also keeps this machine from caching the miss.
async function waitForDns(hostname: string): Promise<void> {
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1"]);
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await resolver.resolve4(hostname);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`The tunnel's hostname, ${hostname}, never showed up in DNS`);
}

// Ctrl+C and kill end Node without running its exit handlers, which close the tunnel.
process.once("SIGINT", () => process.exit(130));
process.once("SIGTERM", () => process.exit(143));
