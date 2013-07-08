"use strict";

(function(d, w) {
  var E = d.getElementById.bind(d);
  w.addEventListener("DOMContentLoaded", function() {
    E("boundingBox").textContent = JSON.stringify(obj.boundingBox);
    E("viewport").textContent = JSON.stringify(obj.viewport);
    E("dependency").textContent = JSON.stringify(obj.dependency);
    E("text").textContent = obj.text;
    redraw();
  }, false);
  
  function redraw() {
    // De-serialize dependency objects
    var commonObjs = new PDFObjects();
    var objs = new PDFObjects();
    
    (function() {
      var fontIds = obj.dependency.fonts;
      var fontIRs = obj.dependencyData.fonts;
      for (var i = 0, l = fontIds.length; i < l; i++) {
        var id = fontIds[i];
        var IR = fontIRs[i];
        var font = Font.fromIR(IR);
        font.bindDOM();
        commonObjs.resolve(id, font);
      }

      var imageIds = obj.dependency.images;
      var imageIRs = obj.dependencyData.images;
      for (var i = 0, l = imageIds.length; i < l; i++) {
        var id = imageIds[i];
        var IR = imageIRs[i];
        var imgData = PDFImageData.fromIR(IR);
        objs.resolve(id, imgData);
      }
    })();
    
    // Resolve operatorList, de-serialize certain commands if needed
    var primitives = [];
    (function() {
      for (var i = 0, l = obj.graphics.length; i < l; i++) {
        var originalPrimitive = obj.graphics[i];
        var primitive = {
          type: originalPrimitive.type,
          stateStack: originalPrimitive.stateStack,
          operatorList: {
            fnArray: [],
            argsArray: []
          }
        };
        var fnArray = primitive.operatorList.fnArray;
        var argsArray = primitive.operatorList.argsArray;
        for (var j = 0, ll = originalPrimitive.commands.length; j < ll; j++) {
          var command = originalPrimitive.commands[j];
          if (command.name === "paintInlineImageXObject" || command.name === "paintInlineImageXObjectGroup") {
            // Restore first argument from IR
            command = {
              name: command.name,
              args: command.args.slice(0)
            };
            var IR = command.args[0];
            command.args[0] = PDFImageData.fromIR(IR);
          }
          fnArray.push(command.name);
          argsArray.push(command.args);
        }
        primitives.push(primitive);
      }
    })();
    
    // Create the viewport information
    var bb = obj.boundingBox;
    var scale = obj.viewport.scale;
    var viewport = new PageViewport([0, 0, bb.width / scale, bb.height / scale], scale, obj.viewport.rotation, obj.viewport.offsetX, obj.viewport.offsetY, true);
    
    // Create the canvas to draw onto
    var canvas = createScratchCanvas(viewport.width, viewport.height);
    E("graphics").appendChild(canvas);
    
    // Prepare drawing
    var canvasCtx = canvas.getContext("2d");
    var gfx = new CanvasGraphics(canvasCtx, commonObjs, objs);
    gfx.beginDrawing(viewport, false);
    for (var i = 0, l = primitives.length; i < l; i++) {
      var primitive = primitives[i];
      gfx.setFullContextStateStack(primitive.stateStack,
        [1, 0, 0, 1, -bb.left, -bb.top]);
      gfx.executeOperatorList(primitive.operatorList)
    }
    gfx.endDrawing();
  }
})(document, window);
