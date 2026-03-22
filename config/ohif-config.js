window.config = {
  routerBasename: '/',
  showStudyList: true,
  extensions: [],
  modes: [],
  showLoadingIndicator: true,
  showWarningMessageForCrossOrigin: false,
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

  defaultDataSourceName: 'orthanc-direct',

  // Customization: dental-optimized window/level presets
  customizationService: {
    dicomUploadComponent:
      '@ohif/extension-cornerstone.customizationModule.cornerstoneDicomUploadComponent',
  },

  // Dental-specific Window/Level presets
  // These appear in the W/L dropdown in the viewer
  defaultWindowLevelPresets: {
    CT: [
      { description: 'Bone (Standard)', window: 2000, level: 500 },
      { description: 'Soft Tissue', window: 400, level: 40 },
      { description: 'Dental Implant', window: 4000, level: 1000 },
      { description: 'Mandibular Canal', window: 2500, level: 700 },
      { description: 'Airway', window: 1600, level: -600 },
      { description: 'Full Range', window: 4096, level: 1024 },
    ],
  },

  hotkeys: [
    // Keep OHIF defaults but add dental shortcuts
    { commandName: 'setToolActive', commandOptions: { toolName: 'Length' }, keys: ['l'] },
    { commandName: 'setToolActive', commandOptions: { toolName: 'Angle' }, keys: ['a'] },
    { commandName: 'setToolActive', commandOptions: { toolName: 'EllipticalROI' }, keys: ['e'] },
  ],
};
