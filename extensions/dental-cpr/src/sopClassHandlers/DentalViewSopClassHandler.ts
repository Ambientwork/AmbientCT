/**
 * DentalViewSopClassHandler
 *
 * Thin SOP class handler that creates a proxy display set for the
 * dental CPR and cross-section viewports.  The display sets carry
 * the same series metadata as the normal stack display sets so the
 * custom vtk.js viewports can locate the Cornerstone3D volume in the
 * cache — but they expose a UNIQUE SOPClassHandlerId so that OHIF's
 * _getViewportComponent can route to DentalViewRouter instead of the
 * default CornerstoneViewport.
 *
 * Having two handlers match the same CT series is intentional and a
 * documented OHIF pattern (the default viewer does the same with
 * stack + 3DSopClassHandler).
 */

/** CT Image Storage SOP Class UID — covers standard CT and CBCT */
const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2';

export const DENTAL_VIEW_HANDLER_ID =
  '@ambientwork/ohif-extension-dental-cpr.sopClassHandlerModule.dentalViewSopClassHandler';

const DentalViewSopClassHandler = {
  name: 'dentalViewSopClassHandler',

  sopClassUids: [CT_IMAGE_STORAGE],

  getDisplaySetsFromSeries(instances: any[]) {
    if (!instances?.length) return [];

    const first = instances[0];
    return [
      {
        SOPClassHandlerId: DENTAL_VIEW_HANDLER_ID,
        // Unique UID so OHIF tracks this display set separately from the
        // stack handler's display set for the same series.
        displaySetInstanceUID: `dental-view:${first.SeriesInstanceUID}`,
        SeriesInstanceUID: first.SeriesInstanceUID,
        StudyInstanceUID: first.StudyInstanceUID,
        SeriesDescription: first.SeriesDescription ?? '',
        SeriesNumber: first.SeriesNumber ?? 0,
        Modality: first.Modality ?? 'CT',
        numImageFrames: instances.length,
        instances,
        // Not reconstructable — prevents Cornerstone from trying to create
        // a full volume from this proxy display set.
        isReconstructable: false,
        isDerived: false,
      },
    ];
  },
};

export default DentalViewSopClassHandler;
