/**
 * Hanging Protocol: cbctDentalCPR
 *
 * 3-panel dental layout:
 *
 *   ┌──────────────┬──────────────────────────┐
 *   │              │                          │
 *   │  Axial CBCT  │   Panoramic CPR          │
 *   │  (draw arch) │   (click → cross-section)│
 *   │              │                          │
 *   ├──────────────┴──────────────────────────┤
 *   │                                         │
 *   │   Cross-Section (⊥ to arch)             │
 *   │                                         │
 *   └─────────────────────────────────────────┘
 */
export const cbctDentalHP = {
  id: 'cbctDentalCPR',
  hasUpdatedPriorsInformation: false,
  name: 'Dental CBCT — 3-panel CPR Layout',
  description:
    'Three-panel layout: axial (draw arch) + panoramic CPR + perpendicular cross-section',
  createdDate: '2026-03-23',
  modifiedDate: '2026-03-23',

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
      name: 'Axial + CPR + Cross-Section',

      stageActivationCriteria: {},

      viewportStructure: {
        layoutType: 'grid',
        properties: { rows: 2, columns: 2 },
      },

      viewports: [
        // ── Top-left: axial CBCT (draw arch here) ──────────────────────────
        {
          viewportOptions: {
            viewportId: 'cbctAxial',
            viewportType: 'stack',
            toolGroupId: 'dentalCPRToolGroup',
            background: [0, 0, 0],
          },
          displaySets: [{ id: 'ctDisplaySet' }],
        },

        // ── Top-right: panoramic CPR ────────────────────────────────────────
        // DentalViewRouter renders DentalCPRViewport for this viewportId.
        {
          viewportOptions: {
            viewportId: 'dentalCPR',
            viewportType: 'stack',
            toolGroupId: 'dentalViewsGroup',
            background: [0, 0, 0],
          },
          displaySets: [{ id: 'ctDisplaySet' }],
        },

        // ── Bottom-left: perpendicular cross-section ─────────────────────────
        // DentalViewRouter renders DentalCrossSectionViewport for this viewportId.
        {
          viewportOptions: {
            viewportId: 'dentalCrossSection',
            viewportType: 'stack',
            toolGroupId: 'dentalViewsGroup',
            background: [0, 0, 0],
          },
          displaySets: [{ id: 'ctDisplaySet' }],
        },

        // ── Bottom-right: empty slot to complete the 2×2 grid ───────────────
        // Required: 2 rows × 2 columns = 4 slots; all must be defined to avoid
        // "No match details for viewport undefined" in HangingProtocolService.
        {
          viewportOptions: {
            viewportId: 'dentalEmpty',
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
