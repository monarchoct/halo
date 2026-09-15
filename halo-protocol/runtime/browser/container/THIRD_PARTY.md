# Container sources

The browser base is Microsoft's official Playwright v1.62.0-noble image. The MCR manifest index was read on 13 September 2026 and is pinned in the Dockerfile to SHA-256 baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07. The installed Playwright package is also 1.62.0.

seccomp.json derives from https://github.com/microsoft/playwright/blob/v1.62.0/utils/docker/seccomp_profile.json, original SHA-256 cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849. Playwright is copyright Microsoft Corporation, Apache-2.0 licensed: https://github.com/microsoft/playwright/blob/v1.62.0/LICENSE. Preserve upstream notices when redistributing.

HALO modification, 13 September 2026: remove the container-capability condition on the existing `chroot` allow rule. With `cap_drop: [ALL]`, that condition prevented Chromium's namespace sandbox from calling `chroot("/proc/self/fdinfo/")` and the real browser crashed at startup. Chromium performs this operation after entering a new user namespace to remove filesystem access (https://github.com/chromium/chromium/blob/main/sandbox/linux/services/credentials.cc). Allowing the syscall does not grant CAP_SYS_CHROOT: the kernel still checks the caller's capability in its user namespace. The container remains UID 1000 with zero capabilities, no-new-privileges, read-only root and active seccomp. Acceptance probes must show chroot fails in the original namespace and succeeds inside the new user namespace, followed by an actual sandboxed Chromium run. No other upstream syscall rules are changed.

PLAYWRIGHT-LICENSE contains the license copied from the installed, pinned Playwright 1.62.0 package. Preserve it alongside the seccomp profile in source distributions.

Deployment guidance: https://playwright.dev/docs/docker. The container uses a non-root numeric user, Chromium's sandbox and the upstream seccomp profile. It has no remote-control or wallet port. The separate internal network and proxy are HALO's additions; their Linux enforcement still requires a real container acceptance run.
