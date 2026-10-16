# Cloud deployment verification

Status: deferred pending a compatible provider and physical-device evidence. This carries forward an
unfinished verification boundary, not an implementation queue or authorization for further work.

The static frontend, independent agent, host management, endpoint-owned reviews, recovery, and
generic cloud launcher are implemented. A prior Debian/x86_64 probe passed Linux agent build/package
and loopback checks. Controlled launcher checks do not establish a real VPN path. Codex Cloud
investigation is closed without a supported deployment. The Linux artifact workflow was prepared;
its dispatch and full Linux/Tailscale installation were not verified in that investigation.

To claim a laptop-closed cloud workflow, select a provider with supported private inbound access and
adequate task lifetime, then follow the
[deployment checks](../current/testing.md#deployment-checks). Record actual provider/device/browser
results, installation and transfer, two-agent isolation, and recovery. Do not convert local
simulation into a physical-device or uptime claim.

Current operation belongs in [operations](../current/operations.md); completed research is retained
in [split-host history](../history/2026-10-15-split-host-research.md). Discovery, a hub, and
cross-device sync remain outside this verification task.
