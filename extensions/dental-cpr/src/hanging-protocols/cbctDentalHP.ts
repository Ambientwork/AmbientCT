/**
 * Hanging Protocol: cbctDentalCPR
 *
 * 2-panel layout (single row):
 *
 *   ┌──────────────┬──────────────────────────────────────────────────┐
 *   │              │  Panoramic CPR (top 60%)                         │
 *   │  Axial CBCT  ├─────────────┬─────────────┬──────────────────────┤
 *   │  (draw arch) │  ⊥ Prev     │  ⊥ Center   │  ⊥ Next              │
 *   │              │             │             │                      │
 *   └──────────────┴─────────────┴─────────────┴──────────────────────┘
 */
export const cbctDentalHP = {
  id: 'cbctDentalCPR',
  hasUpdatedPriorsInformation: false,
  name: 'Dental CBCT — 2-panel CPR Layout',
  description:
    'Two-panel layout: axial (draw arch) + dental container (panoramic top 60% + 3 cross-sections bottom 40%)',
  createdDate: '2026-03-23',
  modifiedDate: '2026-03-26',

  protocolMatchingRules: [
    {
      attribute: 'ModalitiesInStudy',
      constraint: { containsI: 'CT' },
      required: true,
    },
  ],

  // Top-level displaySetSelectors — required by HangingProtocolService._validateProtocol
  displaySetSelectors: {
    ctDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: { equals: { value: 'CT' } },
          required: true,
        },
      ],
    },
  },

  stages: [
    {
      id: 'dentalCPRLayout',
      name: 'Axial + Dental Container',

      stageActivationCriteria: {},

      viewportStructure: {
        layoutType: 'grid',
        properties: { rows: 1, columns: 2 },
      },

      viewports: [
        // ── Left: axial CBCT (draw arch here) ──────────────────────────────
        {
          viewportOptions: {
            viewportId: 'cbctAxial',
            viewportType: 'stack',
            toolGroupId: 'dentalCPRToolGroup',
            background: [0, 0, 0],
            // Start at middle slice so the user immediately sees dental anatomy
            // instead of empty space at the top of the scan.
            initialImageIndex: 'middle',
          },
          displaySets: [{ id: 'ctDisplaySet' }],
        },

        // ── Right: dental container (panoramic top 60% + 3 cross-sections bottom 40%) ──
        // DentalViewRouter renders DentalContainerViewport for this viewportId.
        {
          viewportOptions: {
            viewportId: 'dentalContainer',
            viewportType: 'stack',
            toolGroupId: 'dentalViewsGroup',
            background: [0, 0, 0],
          },
          displaySets: [{ id: 'ctDisplaySet' }],
        },
      ],
    },
  ],
};
