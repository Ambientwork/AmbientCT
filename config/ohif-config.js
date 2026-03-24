window.config = {
  routerBasename: '/',
  showStudyList: true,
  extensions: [],
  modes: [],
  showLoadingIndicator: true,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showPinningToolbarMessage: true,
  strictZSpacingForVolumeViewport: true,

  // Data source: Orthanc via DICOMweb
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc-dicomweb',
      configuration: {
        friendlyName: 'DentalPACS Orthanc',
        name: 'orthanc',
        wadoUriRoot: '/pacs/wado',
        qidoRoot: '/pacs/dicom-web',
        wadoRoot: '/pacs/dicom-web',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
      },
    },
    // Dev mode: direct Orthanc connection (no Nginx proxy)
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc-direct',
      configuration: {
        friendlyName: 'DentalPACS (Dev)',
        name: 'orthanc-direct',
        wadoUriRoot: 'http://localhost:8042/wado',
        qidoRoot: 'http://localhost:8042/dicom-web',
        wadoRoot: 'http://localhost:8042/dicom-web',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
      },
    },
  ],

  defaultDataSourceName: 'orthanc-dicomweb',

  // Customization: dental-optimized upload and viewport overlays
  customizationService: {
    dicomUploadComponent:
      '@ohif/extension-cornerstone.customizationModule.cornerstoneDicomUploadComponent',
  },

  // ---------------------------------------------------------------------------
  // Dental-specific Window/Level presets
  // These appear in the W/L dropdown in the viewer toolbar.
  // Values are optimized for dental CBCT/DVT imaging based on clinical
  // experience — bone density ranges differ from general radiology.
  // ---------------------------------------------------------------------------
  defaultWindowLevelPresets: {
    CT: [
      { description: 'Bone (Standard)', window: 2000, level: 500 },
      { description: 'Soft Tissue', window: 400, level: 40 },
      { description: 'Dental Implant', window: 4000, level: 1000 },
      { description: 'Mandibular Canal', window: 2500, level: 700 },
      { description: 'Airway', window: 1600, level: -600 },
      { description: 'Full Range', window: 4096, level: 1024 },
      // Extended dental presets
      { description: 'Enamel / Dentin', window: 3000, level: 1500 },
      { description: 'Root Canal (Endo)', window: 4000, level: 800 },
      { description: 'Periapical', window: 3000, level: 900 },
      { description: 'TMJ', window: 2500, level: 600 },
    ],
    // Panoramic / OPG / Intraoral (DX modality)
    DX: [
      { description: 'Standard Dental', window: 2048, level: 1024 },
      { description: 'High Contrast', window: 1500, level: 750 },
      { description: 'Soft Tissue', window: 3000, level: 1500 },
      { description: 'Invert (Endo)', window: 2048, level: 1024 },
    ],
  },

  // ---------------------------------------------------------------------------
  // Dental Hanging Protocols
  // Automatically select the best viewport layout based on DICOM Modality tag.
  //   CT  (CBCT/DVT)   -> MPR layout (axial + sagittal + coronal)
  //   DX  (OPG/Panoramic/Intraoral) -> Single 2D viewport
  //   IO  (Intraoral series) -> 2x2 grid layout
  // ---------------------------------------------------------------------------
  hangingProtocols: [
    // CBCT / DVT -> MPR (3-panel: axial, sagittal, coronal)
    {
      id: 'dental-cbct-mpr',
      name: 'Dental CBCT (MPR)',
      protocols: [
        {
          id: 'dental-cbct-mpr',
          name: 'Dental CBCT (MPR)',
          hasUpdatedInitialViewport: false,
          criteria: [
            {
              attribute: 'ModalitiesInStudy',
              constraint: { containsAny: ['CT'] },
            },
          ],
          displaySetSelectors: {
            ctDisplaySet: {
              seriesMatchingRules: [
                {
                  attribute: 'Modality',
                  constraint: { equals: 'CT' },
                },
              ],
            },
          },
          stages: [
            {
              name: 'MPR',
              viewportStructure: {
                layoutType: 'grid',
                properties: { rows: 1, columns: 3 },
              },
              viewports: [
                {
                  viewportOptions: {
                    viewportId: 'axial',
                    viewportType: 'volume',
                    orientation: 'axial',
                    toolGroupId: 'default',
                  },
                  displaySets: [
                    { id: 'ctDisplaySet' },
                  ],
                },
                {
                  viewportOptions: {
                    viewportId: 'sagittal',
                    viewportType: 'volume',
                    orientation: 'sagittal',
                    toolGroupId: 'default',
                  },
                  displaySets: [
                    { id: 'ctDisplaySet' },
                  ],
                },
                {
                  viewportOptions: {
                    viewportId: 'coronal',
                    viewportType: 'volume',
                    orientation: 'coronal',
                    toolGroupId: 'default',
                  },
                  displaySets: [
                    { id: 'ctDisplaySet' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },

    // OPG / Panoramic -> Single 2D viewport
    {
      id: 'dental-opg-single',
      name: 'Dental OPG / Panoramic',
      protocols: [
        {
          id: 'dental-opg-single',
          name: 'Dental OPG / Panoramic',
          hasUpdatedInitialViewport: false,
          criteria: [
            {
              attribute: 'ModalitiesInStudy',
              constraint: { containsAny: ['DX', 'CR', 'PX'] },
            },
          ],
          displaySetSelectors: {
            dxDisplaySet: {
              seriesMatchingRules: [
                {
                  attribute: 'Modality',
                  constraint: { equals: { value: ['DX', 'CR', 'PX'] } },
                },
              ],
            },
          },
          stages: [
            {
              name: 'Single Viewport',
              viewportStructure: {
                layoutType: 'grid',
                properties: { rows: 1, columns: 1 },
              },
              viewports: [
                {
                  viewportOptions: {
                    viewportId: 'opg',
                    viewportType: 'stack',
                    toolGroupId: 'default',
                  },
                  displaySets: [
                    { id: 'dxDisplaySet' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },

    // Intraoral series -> 2x2 Grid layout
    {
      id: 'dental-intraoral-grid',
      name: 'Dental Intraoral (Grid)',
      protocols: [
        {
          id: 'dental-intraoral-grid',
          name: 'Dental Intraoral (Grid)',
          hasUpdatedInitialViewport: false,
          criteria: [
            {
              attribute: 'ModalitiesInStudy',
              constraint: { containsAny: ['IO'] },
            },
          ],
          displaySetSelectors: {
            ioDisplaySet: {
              seriesMatchingRules: [
                {
                  attribute: 'Modality',
                  constraint: { equals: 'IO' },
                },
              ],
            },
          },
          stages: [
            {
              name: 'Grid 2x2',
              viewportStructure: {
                layoutType: 'grid',
                properties: { rows: 2, columns: 2 },
              },
              viewports: [
                {
                  viewportOptions: {
                    viewportId: 'io-1',
                    viewportType: 'stack',
                    toolGroupId: 'default',
                  },
                  displaySets: [{ id: 'ioDisplaySet' }],
                },
                {
                  viewportOptions: {
                    viewportId: 'io-2',
                    viewportType: 'stack',
                    toolGroupId: 'default',
                  },
                  displaySets: [{ id: 'ioDisplaySet' }],
                },
                {
                  viewportOptions: {
                    viewportId: 'io-3',
                    viewportType: 'stack',
                    toolGroupId: 'default',
                  },
                  displaySets: [{ id: 'ioDisplaySet' }],
                },
                {
                  viewportOptions: {
                    viewportId: 'io-4',
                    viewportType: 'stack',
                    toolGroupId: 'default',
                  },
                  displaySets: [{ id: 'ioDisplaySet' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Dental Hotkeys
  // Keyboard shortcuts for frequently used dental measurement and navigation
  // tools. These extend the OHIF default hotkeys.
  // ---------------------------------------------------------------------------
  hotkeys: [
    // Measurement tools — dental workflow essentials
    { commandName: 'setToolActive', commandOptions: { toolName: 'Length' }, keys: ['l'], label: 'Length Measurement' },
    { commandName: 'setToolActive', commandOptions: { toolName: 'Angle' }, keys: ['a'], label: 'Angle Measurement' },
    { commandName: 'setToolActive', commandOptions: { toolName: 'EllipticalROI' }, keys: ['e'], label: 'Elliptical ROI' },
    { commandName: 'setToolActive', commandOptions: { toolName: 'Bidirectional' }, keys: ['b'], label: 'Bidirectional Measurement' },
    { commandName: 'setToolActive', commandOptions: { toolName: 'ArrowAnnotate' }, keys: ['n'], label: 'Arrow Annotation' },

    // Navigation — scroll, zoom, pan, window/level
    { commandName: 'setToolActive', commandOptions: { toolName: 'Zoom' }, keys: ['z'], label: 'Zoom' },
    { commandName: 'setToolActive', commandOptions: { toolName: 'Pan' }, keys: ['p'], label: 'Pan' },
    { commandName: 'setToolActive', commandOptions: { toolName: 'WindowLevel' }, keys: ['w'], label: 'Window/Level' },
    { commandName: 'setToolActive', commandOptions: { toolName: 'StackScrollMouseWheel' }, keys: ['s'], label: 'Scroll' },
    { commandName: 'setToolActive', commandOptions: { toolName: 'Crosshairs' }, keys: ['c'], label: 'Crosshairs (MPR)' },

    // Viewport controls
    { commandName: 'resetViewport', keys: ['r'], label: 'Reset Viewport' },
    { commandName: 'flipViewportHorizontal', keys: ['h'], label: 'Flip Horizontal' },
    { commandName: 'flipViewportVertical', keys: ['v'], label: 'Flip Vertical' },
    { commandName: 'rotateViewportCW', keys: ['.'], label: 'Rotate Clockwise' },
    { commandName: 'invertViewport', keys: ['i'], label: 'Invert (Negative)' },

    // W/L quick presets (Numpad / number keys for fast preset switching)
    { commandName: 'windowLevelPreset1', keys: ['1'], label: 'W/L Preset: Bone' },
    { commandName: 'windowLevelPreset2', keys: ['2'], label: 'W/L Preset: Soft Tissue' },
    { commandName: 'windowLevelPreset3', keys: ['3'], label: 'W/L Preset: Implant' },
    { commandName: 'windowLevelPreset4', keys: ['4'], label: 'W/L Preset: Mandibular Canal' },
    { commandName: 'windowLevelPreset5', keys: ['5'], label: 'W/L Preset: Airway' },
    { commandName: 'windowLevelPreset6', keys: ['6'], label: 'W/L Preset: Full Range' },
  ],
};
