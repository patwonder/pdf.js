<?php
// Redraw clipped objects
?>
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>PDF Clipper Redraw</title>
    <link rel="stylesheet" type="text/css" href="redraw.css" />
    
    <script>
      var obj = JSON.parse(<?php echo json_encode($_REQUEST['json']); ?>);
    </script>
    <script src="redraw.js"></script>
  </head>
  <body>
    <div id="boundingBox"></div>
    <div id="viewport"></div>
    <div id="text"></div>
    <div id="graphics"></div>
  </body>
</html>
