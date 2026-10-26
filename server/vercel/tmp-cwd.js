// The deployed function's source tree is read-only. Provider disk caches
// resolve `.gev-cache` from the working directory when their modules load,
// so move it to the writable /tmp before any provider is imported.
try {
  process.chdir('/tmp');
} catch {
  // Local runs keep their checkout as the working directory.
}
