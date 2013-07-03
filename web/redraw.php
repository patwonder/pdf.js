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
      var obj = JSON.parse(<?php echo json_encode($_POST['json']); ?>);
    </script>
    <script src="redraw.js"></script>
  </head>
  <body>
    <pre><?php 
      $headers = apache_request_headers();

      foreach ($headers as $header => $value) {
        echo "$header: $value \n";
      }
      echo file_get_contents('php://input');
    ?></pre>
    <div id="boundingBox"></div>
    <div id="viewport"></div>
    <div id="dependency"></div>
    <div id="text"></div>
    <div id="graphics"></div>
  </body>
</html>
