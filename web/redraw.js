"use strict";

(function(d, w) {
  var E = d.getElementById.bind(d);
  w.addEventListener("DOMContentLoaded", function() {
    E("boundingBox").textContent = JSON.stringify(obj.boundingBox);
    E("viewport").textContent = JSON.stringify(obj.viewport);
    E("dependency").textContent = JSON.stringify(obj.dependency);
    E("text").textContent = obj.text;
    $("#scale").slider({
      animate: true,
      min: 0.1,
      max: 5.0,
      value: Math.floor(obj.viewport.scale * 100) / 100,
      step: 0.01,
      change: function(event, ui) {
        redraw(ui.value);
      },
      slide: function(event, ui) {
        $("#scaleValue").text(ui.value);
      }
    });
    var scale = $("#scale").slider("option", "value");
    $("#scaleValue").text(scale);
    redraw(scale);
  }, false);
  
  function redraw(newscale) {
    // De-serialize dependency objects
    var commonObjs = new PDFObjects();
    var objs = new PDFObjects();
    var promises = [];
    
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
        if (imgData.promise) {
          promises.push(imgData.promise);
        }
        objs.resolve(id, imgData);
      }
    })();
    
    // Resolve operatorList, de-serialize certain commands if needed
    var transparency = false;
    var primitives = [];
    (function() {
      for (var i = 0, l = obj.graphics.length; i < l; i++) {
        var originalPrimitive = obj.graphics[i];
        var primitive = {
          type: originalPrimitive.type,
          stateStack: originalPrimitive.stateStack,
          operatorList: {
            fnArray: [],
            argsArray: [],
            transparency: originalPrimitive.transparency
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
            if (command.args[0].promise) {
              promises.push(command.args[0].promise);
            }
          }
          fnArray.push(command.name);
          argsArray.push(command.args);
        }
        primitives.push(primitive);
        transparency = transparency || originalPrimitive.transparency;
      }
    })();
    
    redraw = function(newscale) {
      newscale = newscale || 1.0;

      // Create the viewport information
      var bb = obj.boundingBox;
      var scale = obj.viewport.scale;
      var viewport = new PageViewport([0, 0, bb.width / scale, bb.height / scale], newscale, obj.viewport.rotation, obj.viewport.offsetX, obj.viewport.offsetY, true);
      
      // Create the canvas to draw onto
      var canvas = E("graphics").querySelector("canvas.redraw") || (function() {
        var canvas = d.createElement("canvas");
        canvas.className = "redraw";
        E("graphics").appendChild(canvas);
        return canvas;
      })();
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      // Prepare drawing
      var canvasCtx = canvas.getContext("2d");
      var gfx = new CanvasGraphics(canvasCtx, commonObjs, objs);
      gfx.beginDrawing(viewport, transparency);
      for (var i = 0, l = primitives.length; i < l; i++) {
        var primitive = primitives[i];
        gfx.setFullContextStateStack(primitive.stateStack,
          Util.transformAll([1, 0, 0, 1, -bb.left, -bb.top],
          [newscale / scale, 0, 0, newscale / scale, 0, 0]));
        gfx.executeOperatorList(primitive.operatorList)
      }
      gfx.endDrawing();
    };
    
    Promise.all(promises).then(function() {
      redraw(newscale);
      
      // Paint each image separately
      var imageIds = obj.dependency.images;
      for (var i = 0, l = imageIds.length; i < l; i++) {
        var id = imageIds[i];
        var imageObject = objs.get(id);
        var src = "";
        if (imageObject) {
          if (imageObject instanceof HTMLImageElement) {
            // for jpeg images, get the image src directly
            src = imageObject.src;
          } else {
            // otherwise, paint it onto a canvas and get the png data
            var width = imageObject.width;
            var height = imageObject.height;
            var canvas = d.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            var ctx = canvas.getContext("2d");
            CanvasGraphics.putBinaryImageData(ctx, imageObject);
            src = canvas.toDataURL("image/png");
          }
          E("graphics").appendChild((function() {
            var div = d.createElement("div");
            div.textContent = id;
            div.appendChild((function() {
              var img = new Image();
              img.src = src;
              return img;
            })());
            return div;
          })());
        }
      }
    });
  }
})(document, window);
