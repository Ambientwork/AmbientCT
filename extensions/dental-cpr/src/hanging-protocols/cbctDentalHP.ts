/**
 * Hanging Protocol: cbctDentalCPR
 *
 * Fires when a CT/CBCT study is opened — automatically loads the
 * 2-panel dental layout: Axial view (left) + Panoramic CPR (right).
 */
export const cbctDentalHP = {
  id: 'cbctDentalCPR',
  hasUpdatedPriorsInformation: false,
  name: 'Dental CBCT + Panoramic CPR',
  description:
    'Two-panel layout for dental CBCT: axial view for arch drawing + CPR panoramic reconstruction',
  createdDate: '2026-03-23',
  modifiedDate: '2026-03-23',

  // Match any study containing CT modality
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
      name: 'Axial + Panoramic CPR',

      stageActivationCriteria: {},

      viewportStructure: {
        layoutType: 'grid',
        properties: { rows: 1, columns: 2 },
      },

      viewports: [
        // ── Left panel: axial CBCT (user draws arch here) ──────────────────
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
          position: { x: 0, y: 0, width: 0.5, height: 1.0 },
        },

        // ── Right panel: dental CPR panoramic viewport ──────────────────────
        {
          viewportOptions: {
            viewportId: 'dentalCPR',
            viewportType: 'custom',
            customViewportType:
              '@ambientwork/ohif-extension-dental-cpr.viewportModule.dentalCPRViewport',
            toolGroupId: 'dentalCPRToolGroup',
          },
          displaySets: [{ id: 'ctDisplaySet' }],
          position: { x: 0.5, y: 0, width: 0.5, height: 1.0 },
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
