/** Evaluate only the extracted YouTube player program in an opaque-origin frame.
 * No app storage, DOM, Worker token, or same-origin API is exposed to the code.
 * The program has no network permissions; dispose the frame after each evaluation.
 */
export function evaluatePlayerProgram(
  program: string,
  timeoutMs = 10_000,
): Promise<unknown> {
  if (typeof program !== "string" || program.length > 4_000_000)
    return Promise.reject(
      new Error("Invalid or oversized YouTube player program"),
    );
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    const channel = new MessageChannel();
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      frame.remove();
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = window.setTimeout(
      () => fail(new Error("YouTube player evaluation timed out")),
      timeoutMs,
    );
    channel.port1.onmessage = (event) => {
      const result = event.data;
      cleanup();
      if (result?.ok) resolve(result.value);
      else
        reject(
          new Error(
            typeof result?.error === "string"
              ? result.error
              : "YouTube player evaluation failed",
          ),
        );
    };
    frame.addEventListener(
      "load",
      () => {
        if (!finished)
          frame.contentWindow?.postMessage(
            { type: "youtv-player-eval", program },
            "*",
            [channel.port2],
          );
      },
      { once: true },
    );
    // This document contains no user-controlled HTML or interpolation.
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; form-action 'none'; base-uri 'none'"><script>addEventListener('message',async e=>{if(e.source!==parent||e.data?.type!=='youtv-player-eval'||!e.ports[0])return;const port=e.ports[0];try{const value=await new Function(e.data.program)();port.postMessage({ok:true,value})}catch(error){port.postMessage({ok:false,error:String(error?.message||error)})}finally{port.close()}},{once:true})<\/script>`;
    document.body.append(frame);
  });
}
