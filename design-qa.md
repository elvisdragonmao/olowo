# oluwu list-first prototype design QA

## Evidence

- Design source: `apps/web/design/oluwu-list-map-reference.png`
- Implementation capture: `apps/web/design/implementation-iphone.png`
- Side-by-side comparison: `apps/web/design/design-qa-comparison.png`
- Target viewport: iPhone app viewport, 393 x 852 CSS px
- Capture canvas: 1280 x 1100 px at device scale factor 1
- Source image: 853 x 1844 px; normalized to 393 x 852 for comparison
- State: initial nearby-scooter list, JZ-333 selected, no sheet open

## Full-view comparison

The implementation preserves the reference hierarchy: compact brand header, map overview, dominant `9 台可借` count, three ranked rows, unavailable-reason disclosure, and a sticky selected-scooter action. The revised product requirement is also preserved: there is no address selector, and available vehicles are labeled `可借`.

The live implementation intentionally uses interactive OpenStreetMap raster tiles instead of copying the generated static map artwork. Map attribution and the location control therefore differ from the reference while keeping the same footprint and function.

## Focused-region comparison

The central map-summary-list region was compared at equal width. Vehicle IDs, walk times, exact battery percentages, estimated ranges and availability are aligned to the same scan order. The implementation uses compact Phosphor icons for unselected vehicles and a real oloo scooter image for the selection; this makes selection state clearer without changing the information hierarchy.

## Findings and iteration history

1. The first capture allowed the bottom safe-area variable to collapse outside the runtime's `.mobile-page` wrapper. Added a 34 px iOS fallback and a zero-safe-area Android override. The selected-scooter bar now clears the home indicator and stays fully usable.
2. The first map view clipped two battery markers near the upper edge. Recentered the initial viewport and reduced zoom so all three nearby examples are visible.
3. The MapLibre worker originally failed to load in the browser preview. Configured the bundled worker URL; the map now renders without page errors.
4. Reduced map, heading and row heights so all three ranked vehicles and the unavailable-reason disclosure remain reachable in the first screen while preserving 44 px minimum controls.
5. Functional checks confirmed row-to-map selection, minimum-battery filtering, reason-sheet presentation, 393 px layout width, and no horizontal overflow.
6. Split the MapLibre implementation into a lazy-loaded map chunk so the ranked list and availability summary can render before the mapping library. The browser test now waits for all three map markers before capturing visual evidence.
7. Remaining variance is intentional: live map imagery, required map attribution, and compact unselected vehicle icons. No actionable P0, P1 or P2 fidelity issues remain.

## Final result

passed
