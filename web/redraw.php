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
    <script src="../src/network.js"></script>
    <script src="../src/chunked_stream.js"></script>
    <script src="../src/pdf_manager.js"></script>
    <script src="../src/core.js"></script>
    <script src="../src/base64.js"></script>
    <script src="../src/util.js"></script>
    <script src="../src/api.js"></script>
    <script src="../src/metadata.js"></script>
    <script src="../src/canvas.js"></script>
    <script src="../src/obj.js"></script>
    <script src="../src/annotation.js"></script>
    <script src="../src/function.js"></script>
    <script src="../src/charsets.js"></script>
    <script src="../src/cidmaps.js"></script>
    <script src="../src/colorspace.js"></script>
    <script src="../src/crypto.js"></script>
    <script src="../src/evaluator.js"></script>
    <script src="../src/fonts.js"></script>
    <script src="../src/font_renderer.js"></script>
    <script src="../src/glyphlist.js"></script>
    <script src="../src/image.js"></script>
    <script src="../src/metrics.js"></script>
    <script src="../src/parser.js"></script>
    <script src="../src/pattern.js"></script>
    <script src="../src/stream.js"></script>
    <script src="../src/worker.js"></script>
    <script src="../external/jpgjs/jpg.js"></script>
    <script src="../src/jpx.js"></script>
    <script src="../src/jbig2.js"></script>
    <script src="../src/bidi.js"></script>
    <script>PDFJS.workerSrc = '../src/worker_loader.js';</script>

    <script src="redraw.js"></script>
  </head>
  <body>
    <pre><?php 
      $headers = apache_request_headers();

      foreach ($headers as $header => $value) {
        echo "$header: $value \n";
      }
    ?></pre>
    <div id="boundingBox"></div>
    <div id="viewport"></div>
    <div id="dependency"></div>
    <div id="text"></div>
    <div id="graphics"></div>
  </body>
</html>
