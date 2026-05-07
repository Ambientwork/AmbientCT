# Third-Party Notices

AmbientCT is an open-source project by Ambientwork.

This project includes or depends on third-party open-source software. Rebranding the product UI as `AmbientCT` does not remove the obligation to preserve upstream license notices and copyright notices.

## Core upstream components

- **OHIF Viewers**  
  License: MIT  
  Upstream: https://github.com/OHIF/Viewers

- **Cornerstone3D**  
  License: MIT  
  Upstream: https://github.com/cornerstonejs/cornerstone3D

- **vtk.js**  
  License: BSD-3-Clause  
  Upstream: https://github.com/Kitware/vtk-js

- **Orthanc**  
  Core license: GPLv3+  
  Licensing guide: https://orthanc.uclouvain.be/book/faq/licensing.html

## Orthanc-specific note

AmbientCT communicates with Orthanc as a PACS backend over DICOMweb, REST, and DICOM protocols. This repository also enables official Orthanc plugins at runtime in [`docker-compose.yml`](/Users/john/dev/AmbientCT/docker-compose.yml) and [`config/orthanc.json`](/Users/john/dev/AmbientCT/config/orthanc.json).

If you redistribute modified Orthanc core code or modified official Orthanc plugins, review Orthanc's GPL/AGPL obligations separately. In particular, Orthanc's official documentation states that native Orthanc plugins are not permissively licensed because they are coupled to the Orthanc SDK.

## Redistribution checklist

- Keep the AmbientCT MIT license in [LICENSE](/Users/john/dev/AmbientCT/LICENSE).
- Preserve upstream license texts and notices for bundled or redistributed dependencies.
- Do not imply endorsement by OHIF, Orthanc, Cornerstone, or Kitware.
- Keep technical attribution where accurate, even if the product name shown to users is `AmbientCT`.
