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
            viewportType: 'volume',
            orientation: 'axial',
            toolGroupId: 'dentalCPRToolGroup',
            initialImageOptions: { preset: -1 },
            background: [0, 0, 0],
          },
          displaySets: [{ id: 'ctDisplaySet' }],
          position: { x: 0, y: 0, width: 0.5, height: 0.5 },
        },

        // ── Top-right: panoramic CPR ────────────────────────────────────────
        {
          viewportOptions: {
            viewportId: 'dentalCPR',
            viewportType: 'custom',
            customViewportType:
              '@ambientwork/ohif-extension-dental-cpr.viewportModule.dentalCPRViewport',
            toolGroupId: 'dentalCPRToolGroup',
          },
          displaySets: [{ id: 'ctDisplaySet' }],
          position: { x: 0.5, y: 0, width: 0.5, height: 0.5 },
        },

        // ── Bottom-full: perpendicular cross-section ────────────────────────
        {
          viewportOptions: {
            viewportId: 'dentalCrossSection',
            viewportType: 'custom',
            customViewportType:
              '@ambientwork/ohif-extension-dental-cpr.viewportModule.dentalCrossSectionViewport',
            toolGroupId: 'dentalCPRToolGroup',
          },
          displaySets: [{ id: 'ctDisplaySet' }],
          position: { x: 0, y: 0.5, width: 1.0, height: 0.5 },
        },
      ],

      displaySets: [
        {
          id: 'ctDisplaySet',
          seriesMatchingRules: [
            {
              attribute: 'Modality',
              constraint: { equals: 'CT' },
              required: true,
            },
          ],
        },
      ],
    },
  ],
};
