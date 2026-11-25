import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { PreparationIndicator } from "../features/player/PreparationIndicator";

test("preparation details are opt-in, update without opening, and dismiss with Escape",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    const render=(progress:number)=>act(()=>root.render(createElement(PreparationIndicator,{progress,label:"Preparation",children:"Received 5 / 10 seconds"})));
    await render(.5);
    const button=host.querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("50");
    await act(()=>button.click());
    expect(document.querySelector("[role=dialog]")?.textContent).toBe("Received 5 / 10 seconds");
    await render(1);
    expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("100");
    await act(()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(button);
    await act(()=>button.click());
    await act(()=>document.body.dispatchEvent(new Event("pointerdown",{bubbles:true})));
    expect(document.querySelector("[role=dialog]")).toBeNull();
  }finally{await act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
