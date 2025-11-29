/**
 * Ensures the cloudflared tunnel is running before tests start.
 * If not running, starts it in the background.
 * Environment variables are expected to be already available via op run.
 */
export declare function ensureTunnelRunning(): Promise<void>;
/**
 * Stops the cloudflared tunnel if it was started by this process
 */
export declare function stopTunnel(): void;
//# sourceMappingURL=tunnel-manager.d.ts.map
