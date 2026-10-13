import { useLayoutEffect, useRef } from "preact/hooks";

type Geometry = { height: number | null; blocks: Map<number, number> };
const geometryByResource = new WeakMap<object, Map<string, Geometry>>();
const layoutLimit = 4;
let fontVersion = 0;
let watchingFonts = false;

/** Remember only laid-out sizes, without measuring skipped descendants or rendering components. */
export function useCodeRendering(resource: object, wrap: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const contained =
    CSS.supports("content-visibility", "auto") &&
    CSS.supports("contain-intrinsic-block-size", "1px") &&
    typeof Element.prototype.checkVisibility === "function" &&
    typeof ResizeObserver !== "undefined";
  useLayoutEffect(() => {
    const pane = ref.current;
    if (pane === null || !contained) return;
    if (!watchingFonts) {
      document.fonts.addEventListener("loadingdone", () => fontVersion++);
      watchingFonts = true;
    }
    const blocks = [...pane.querySelectorAll<HTMLElement>(".code-render-block")];
    const indices = new Map(blocks.map((block, index) => [block, index]));
    let layouts = geometryByResource.get(resource);
    if (layouts === undefined) {
      layouts = new Map();
      geometryByResource.set(resource, layouts);
    }
    const resourceLayouts = layouts;
    let signature = "";
    let geometry: Geometry = { height: null, blocks: new Map() };
    let observer: ResizeObserver | null = null;
    const observe = (): void => {
      observer?.observe(pane);
      if (wrap) for (const block of blocks) observer?.observe(block);
    };
    const synchronizeLayout = (): boolean => {
      const style = getComputedStyle(pane);
      const next = JSON.stringify([
        pane.getBoundingClientRect().width,
        window.innerWidth,
        wrap,
        style.getPropertyValue("--code-font-family"),
        style.getPropertyValue("--code-font-size"),
        style.getPropertyValue("--space-1"),
        fontVersion,
      ]);
      if (next === signature) return false;
      for (const index of geometry.blocks.keys())
        blocks[index]?.style.removeProperty("contain-intrinsic-block-size");
      pane.style.removeProperty("contain-intrinsic-block-size");
      signature = next;
      const cached = resourceLayouts.get(next);
      geometry = cached ?? { height: null, blocks: new Map() };
      resourceLayouts.delete(next);
      resourceLayouts.set(next, geometry);
      if (resourceLayouts.size > layoutLimit) {
        const oldest = resourceLayouts.keys().next().value;
        if (oldest !== undefined) resourceLayouts.delete(oldest);
      }
      for (const [index, height] of geometry.blocks)
        blocks[index]?.style.setProperty("contain-intrinsic-block-size", `${height}px`);
      if (geometry.height !== null)
        pane.style.setProperty("contain-intrinsic-block-size", `${geometry.height}px`);
      // Discard pending measurements from the previous layout and request fresh observations.
      observer?.disconnect();
      observe();
      return true;
    };
    synchronizeLayout();
    observer = new ResizeObserver((entries) => {
      if (synchronizeLayout()) return;
      // Read visibility before writing any estimates; interleaving forces repeated layout.
      const rendered = entries.filter((entry) => {
        const child = entry.target.firstElementChild;
        // checkVisibility tests skipped ancestors, so test a child of the contained box.
        return child?.checkVisibility({ contentVisibilityAuto: true }) === true;
      });
      for (const entry of rendered) {
        const target = entry.target;
        if (!(target instanceof HTMLElement)) continue;
        const height = entry.contentRect.height;
        if (target === pane) {
          geometry.height = height;
          pane.style.setProperty("contain-intrinsic-block-size", `${height}px`);
        } else {
          const index = indices.get(target);
          if (index === undefined || !wrap) continue;
          geometry.blocks.set(index, height);
          target.style.setProperty("contain-intrinsic-block-size", `${height}px`);
        }
      }
    });
    observe();
    // Typography changes live on the app; width changes are delivered by ResizeObserver.
    const app = pane.closest(".app");
    const typography = new MutationObserver(synchronizeLayout);
    if (app !== null)
      typography.observe(app, { attributes: true, attributeFilter: ["style", "data-code-font"] });
    document.fonts.addEventListener("loadingdone", synchronizeLayout);
    window.addEventListener("resize", synchronizeLayout);
    return () => {
      observer?.disconnect();
      typography.disconnect();
      document.fonts.removeEventListener("loadingdone", synchronizeLayout);
      window.removeEventListener("resize", synchronizeLayout);
      pane.style.removeProperty("contain-intrinsic-block-size");
      for (const index of geometry.blocks.keys())
        blocks[index]?.style.removeProperty("contain-intrinsic-block-size");
    };
  }, [resource, wrap, contained]);
  return { ref, contained };
}
