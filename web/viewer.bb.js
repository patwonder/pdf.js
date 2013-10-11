'use strict';

var BoundingBoxType = {
  TEXT: 1,
  IMAGE: 2,
  PRIMITIVE: 3,
  PRIMITIVE_TEXT: 4,
  CLIP_PATH: 5
};

function BoundingBox(left, top, width, height) {
  this.left = left;
  this.top = top;
  this.width = width;
  this.height = height;
}

BoundingBox.prototype = {
  get right() {
    return this.left + this.width;
  },
  get bottom() {
    return this.top + this.height;
  },
  clone: function() {
    return new BoundingBox(this.left, this.top, this.width, this.height);
  },
  intersect: function(bb) {
    var PORTION_THRESHOLD = 0.8;
    // compute the intersection area
    var iw = Math.max(0, Math.min(this.right, bb.right) - Math.max(this.left, bb.left));
    var ih = Math.max(0, Math.min(this.bottom, bb.bottom) - Math.max(this.top, bb.top));
    // intersection detection based on portion of intersection area
    var portion = iw * ih / (bb.width * bb.height);
    return portion >= PORTION_THRESHOLD;
  },
  extendPoint: function(pt) {
    if (pt.x < this.left) {
      this.width = this.right - pt.x;
      this.left = pt.x;
    } else if (pt.x > this.right)
      this.width = pt.x - this.left;
    
    if (pt.y < this.top) {
      this.height = this.bottom - pt.y;
      this.top = pt.y;
    } else if (pt.y > this.bottom)
      this.height = pt.y - this.top;
  },
  extendBoundingBox: function(bb) {
    this.extendPoint({ x: bb.left, y: bb.top });
    this.extendPoint({ x: bb.right, y: bb.bottom });
  },
  restrict: function(bb) {
    if (this.left < bb.left) {
      this.width -= bb.left - this.left;
      this.width = Math.max(0, this.width);
      this.left = bb.left;
    }
    if (this.top < bb.top) {
      this.height -= bb.top - this.top;
      this.height = Math.max(0, this.height);
      this.top = bb.top;
    }
    if (this.right > bb.right) {
      this.left = Math.min(bb.right, this.left);
      this.width -= this.right - bb.right;
    }
    if (this.bottom > bb.bottom) {
      this.top = Math.min(bb.top, this.top);
      this.height -= this.bottom - bb.bottom;
    }
  },
  rotate: function(angle, origin) {
    // calculate rotated positions of the four corners
    // and create a new bounding box upon that
    var sina = Math.sin(angle);
    var cosa = Math.cos(angle);
    var tl = { x: cosa * (this.left - origin.x) - sina * (this.top - origin.y) + origin.x,
               y: sina * (this.left - origin.x) + cosa * (this.top - origin.y) + origin.y };
    var tr = { x: cosa * (this.right - origin.x) - sina * (this.top - origin.y) + origin.x,
               y: sina * (this.right - origin.x) + cosa * (this.top - origin.y) + origin.y };
    var bl = { x: cosa * (this.left - origin.x) - sina * (this.bottom - origin.y) + origin.x,
               y: sina * (this.left - origin.x) + cosa * (this.bottom - origin.y) + origin.y };
    var br = { x: cosa * (this.right - origin.x) - sina * (this.bottom - origin.y) + origin.x,
               y: sina * (this.right - origin.x) + cosa * (this.bottom - origin.y) + origin.y };
    this.left = Math.min(tl.x, tr.x, bl.x, br.x);
    this.width = Math.max(tl.x, tr.x, bl.x, br.x) - this.left;
    this.top = Math.min(tl.y, tr.y, bl.y, br.y);
    this.height = Math.max(tl.y, tr.y, bl.y, br.y) - this.top;
  }
};

BoundingBox.fromGeometry = function(geom) {
  geom.angle = geom.angle || 0;
  var fontHeight = geom.fontSize * Math.abs(geom.vScale);
  var fontHeightDiff = Math.max(0, geom.divHeight - fontHeight);
  var bb = new BoundingBox(
    /*left*/geom.x + (fontHeight * Math.sin(geom.angle)),
    /*top*/geom.y - (fontHeight * Math.cos(geom.angle)),
    /*width*/geom.canvasWidth * geom.hScale,
    /*height*/fontHeight + fontHeight * 0.382);
  if (geom.angle)
    bb.rotate(geom.angle, { x: bb.left, y: bb.top });
  return bb;
};

BoundingBox.fromElement = function(element, bbLayerDiv) {
  var pos = { left: element.offsetLeft, top: element.offsetTop };
  pos = Utils.translatePosition(pos, element.offsetParent, bbLayerDiv);
  return new BoundingBox(pos.left, pos.top, element.offsetWidth, element.offsetHeight);
};

function BoundingBoxLayerBuilder(bbLayerDiv, pageIdx, width, height, viewport, commonObjs, objs) {
  this._bbLayerFrag = document.createDocumentFragment();
  
  this.bbLayerDiv = bbLayerDiv;
  this.pageIdx = pageIdx;
  this.layoutDone = false;
  
  this.isSelecting = false;
  this.selectionBB = new BoundingBox(0, 0, 0, 0);
  this.canvasBB = new BoundingBox(0, 0, width, height);
  this.viewport = viewport;
  this.commonObjs = commonObjs;
  this.objs = objs;
  
  // create local function copies for storing timer ids
  this.doDetect = this.doDetect.bind(this);
  this.renderLayer = this.renderLayer.bind(this);
}

BoundingBoxLayerBuilder.isBBVisible = function(bb) {
  var MIN_BB_SELECTION_WIDTH = 4;
  var MIN_BB_SELECTION_HEIGHT = 4;
  var width = Math.abs(bb.width - 1) + 1;
  var height = Math.abs(bb.height - 1) + 1;
  return width >= MIN_BB_SELECTION_WIDTH && height >= MIN_BB_SELECTION_HEIGHT;
};

BoundingBoxLayerBuilder.removeDependency = function(content) {
  if (!content.dependency)
    return content;

  var newContent = {};
  for (var prop in content) {
    if (prop != "dependency") {
      newContent[prop] = content[prop];
    }
  }
  return newContent;
};

BoundingBoxLayerBuilder.purifyContent = function(content) {
  var extraProps = ["dependency", "clipPathObject"];
  for (var i = 0, l = extraProps.length; i < l; i++) {
    if (typeof(content[extraProps[i]]) !== "undefined") {
      var newContent = {};
      for (var prop in content) {
        var special = false;
        for (var j = 0; j < l; j++) {
          if (extraProps[j] === prop) {
            special = true;
            break;
          }
        }
        if (!special)
          newContent[prop] = content[prop];
      }
      return newContent;
    }
  }
  return content;
};

BoundingBoxLayerBuilder.analyzeDependency = function(content, dependency) {
  if (content.dependency) {
    var dep = content.dependency;
    for (var font in dep.fonts) {
      dependency.fonts[font] = true;
    }
    for (var image in dep.images) {
      dependency.images[image] = true;
    }
  }
};

BoundingBoxLayerBuilder.getDependencyArray = function(dependency) {
  var res = { fonts: [], images: [] };
  for (var font in dependency.fonts) {
    res.fonts.push(font);
  }
  for (var image in dependency.images) {
    res.images.push(image);
  }
  return res;
};

BoundingBoxLayerBuilder.prototype = {
  beginLayout: function() {
    this.bbDivs = [];
    this.bbs = [];
    this.bbContents = [];
  },
  
  endLayout: function() {
    this.layoutDone = true;
    this.insertDivContent();
  },
  
  renderLayer: function() {
    var bbDivs = this.bbDivs;
    var bbLayerDiv = this.bbLayerDiv;
    var bbLayerFrag = this._bbLayerFrag;
    
    // No point in rendering so many divs as it'd make the browser unusable
    // even after the divs are rendered
    var MAX_TEXT_DIVS_TO_RENDER = 100000;
    if (bbDivs.length > MAX_TEXT_DIVS_TO_RENDER)
      return;

    for (var i = 0, l = bbDivs.length; i < l; i++) {
      var bbDiv = bbDivs[i];
      bbLayerFrag.appendChild(bbDiv);
    }
    
    this.renderingDone = true;
    
    bbLayerDiv.appendChild(bbLayerFrag);
    
    // Add event listeners for bounding box layer selection
    bbLayerDiv.addEventListener("mousedown", this.onMouseDown.bind(this), false);
    bbLayerDiv.addEventListener("mouseup", this.onMouseUp.bind(this), false);
  },
  
  setupRenderLayoutTimer: function() {
    var RENDER_DELAY = 200; // in ms
    this._setupTimer(this.renderLayer, function() {
      return PDFView.lastScroll;
    }, RENDER_DELAY);
  },
  
  appendBoundingBox: function(bb, content) {
    if (!content.hide) {
      bb.restrict(this.canvasBB);
      var bbDiv = document.createElement("div");
      
      bbDiv.dataset.contentIdx = this.bbContents.length;
      
      bbDiv.style.left = bb.left + "px";
      bbDiv.style.top = bb.top + "px";
      bbDiv.style.width = bb.width + "px";
      bbDiv.style.height = bb.height + "px";
      
      this.bbs.push(bb);
      this.bbDivs.push(bbDiv);
    }
    this.bbContents.push(content);
  },
  
  setTextContent: function(textContent) {
    this.textContent = textContent;
    this.insertDivContent();
  },
  
  insertDivContent: function() {
    // Only set the content of the divs once layout has finished, the content
    // for the divs is available and content is not yet set on the divs.
    if (!this.layoutDone || this.divContentDone || !this.textContent)
      return;

    this.divContentDone = true;

    var bbContents = this.bbContents;
    var bidiTexts = this.textContent.bidiTexts;

    // Assign text content from the textContent we just get
    for (var i = 0, j = 0, l = bidiTexts.length; i < l; i++) {
      var bidiText = bidiTexts[i];
      while (bbContents[j++].type != BoundingBoxType.TEXT);
      
      bbContents[j - 1].textContent = bidiText.str;
    }

    this.setupRenderLayoutTimer();
  },
  
  // Selection event handling
  onMouseDown: function(event) {
    // we're expecting left clicks only
    if (event.button !== 0)
      return;

    // do not process clicks on the clip button, etc
    var target = event.target;
    while (target != this.bbLayerDiv) {
      if (target.classList && target.classList.contains("bypassSelection"))
        return;
      target = target.parentElement;
    }

    // Prevent Chrome changing mouse icon to I-beam while dragging
    event.preventDefault();
    
    var initialBB = null;
    if (Utils.matchesSelector(event.target, ".bbLayer > div:not(.bbLayerSelection)")) {
      initialBB = BoundingBox.fromElement(event.target, this.bbLayerDiv);
    }
    
    // We wanna handle all subsequent mouse events on the layer div
    // It's not necessary to bubble everything up
    // Note that Chrome does not yet support this (as of July 2013)
    if (this.bbLayerDiv.setCapture)
      this.bbLayerDiv.setCapture(true);
    
    // If listener still bound, e.g. due to focus lost while selecting,
    // we should not try to initiate another selection gesture
    if (this._onMouseMoveBinded)
      return;
    
    this._onMouseMoveBinded = this.onMouseMove.bind(this);
    this.bbLayerDiv.addEventListener("mousemove", this._onMouseMoveBinded, false);
    
    var pos = Utils.translatePosition({ left: event.pageX, top: event.pageY }, null, this.bbLayerDiv);
    this.onSelectionStart(pos, initialBB);
  },
  
  onMouseUp: function(event) {
    // we're expecting left clicks only
    if (event.button !== 0)
      return;

    // do not handle when no event handler is bound
    if (!this._onMouseMoveBinded)
      return;

    this.onMouseMove(event);
    this.bbLayerDiv.removeEventListener("mousemove", this._onMouseMoveBinded,
    false);
    this._onMouseMoveBinded = null;
    
    var pos = Utils.translatePosition({ left: event.pageX, top: event.pageY }, null, this.bbLayerDiv);
    this.onSelectionEnd(pos);
  },
  
  onMouseMove: function(event) {
    var pos = Utils.translatePosition({ left: event.pageX, top: event.pageY }, null, this.bbLayerDiv);
    this.onSelectionMove(pos);
  },
  
  onSelectionStart: function(pos, initialBB) {
    // Single selection box
    var lastBuilder = BoundingBoxLayerBuilder._lastBuilder;
    if (lastBuilder && lastBuilder !== this)
      lastBuilder.clearSelection();
    BoundingBoxLayerBuilder._lastBuilder = this;

    var selectionBB = this.selectionBB = new BoundingBox(pos.left, pos.top, 1, 1);
    this.initialBB = initialBB || selectionBB.clone();
    selectionBB = this.initialBB;
    
    // Create the div for displaying the selection
    // Use a single div for all bounding box layers
    var selectionDiv = this._selectionDiv || (this._selectionDiv = (function() {
      var div = document.createElement("div");
      div.addEventListener("PDFControllerClip", function() {
        this.doClip();
      }.bind(this));
      return div;
    }).call(this));
    selectionDiv.className = "bbLayerSelection";
    selectionDiv.style.left = selectionBB.left + "px";
    selectionDiv.style.top = selectionBB.top + "px";
    selectionDiv.style.width = selectionBB.width + "px";
    selectionDiv.style.height = selectionBB.height + "px";
    selectionDiv.style.visibility = this.isSelectionVisible() ? "visible" : "hidden";
    this.bbLayerDiv.appendChild(selectionDiv);
    
    if (this._clipButton) {
      this._clipButton.style.visibility = "hidden";
    }
    
    this._lastSelectionAction = Date.now();
    this.setupDetectionTimer();

    var event = document.createEvent("CustomEvent");
    event.initCustomEvent("PDFViewerSelectionStart", true, true, null);
    selectionDiv.dispatchEvent(event);
  },
  
  onSelectionEnd: function(pos) {
    var clipButton = this._clipButton;
    if (!clipButton) {
      clipButton = this._clipButton = document.createElement("button");
      clipButton.className = "clipButton bypassSelection";
      clipButton.innerHTML = "Clip";
      clipButton.style.zIndex = 1;
      clipButton.addEventListener("click", function(event) {
        this.doClip();
      }.bind(this), false);
      this.bbLayerDiv.appendChild(clipButton);
    }
    var tempBB = this.getSelectionBB();
    clipButton.style.left = tempBB.left + "px";
    clipButton.style.top = tempBB.top + "px";
    clipButton.style.visibility = this.isSelectionVisible() ? "visible" : "hidden";

    var event = document.createEvent("CustomEvent");
    event.initCustomEvent("PDFViewerSelectionEnd", true, true, this.isSelectionVisible() ? "visible" : "hidden");
    this._selectionDiv.dispatchEvent(event);
  },
  
  onSelectionMove: function(pos) {
    var selectionBB = this.selectionBB;
    var selectionDiv = this._selectionDiv;

    selectionBB.width = pos.left - selectionBB.left + 1;
    selectionBB.height = pos.top - selectionBB.top + 1;
    
    var tempBB = this.getSelectionBB();
    
    selectionDiv.style.left = tempBB.left + "px";
    selectionDiv.style.top = tempBB.top + "px";
    selectionDiv.style.width = tempBB.width + "px";
    selectionDiv.style.height = tempBB.height + "px";
    selectionDiv.style.visibility = this.isSelectionVisible() ? "visible" : "hidden";

    this._lastSelectionAction = Date.now();
    this.setupDetectionTimer();
  },

  clearSelection: function() {
    // restricts to 0, 0, 0, 0
    this.selectionBB = this.initialBB = new BoundingBox(-1, -1, 1, 1);
    this.setupDetectionTimer();
    if (this._selectionDiv)
      this._selectionDiv.style.visibility = "hidden";
    if (this._clipButton)
      this._clipButton.style.visibility = "hidden";
  },
  
  getSelectionBB: function() {
    var selectionBB = this.selectionBB;
    if (!BoundingBoxLayerBuilder.isBBVisible(selectionBB))
      selectionBB = this.initialBB;
    
    // handle reversed selection
    var tempBB = new BoundingBox(selectionBB.left, selectionBB.top,
      selectionBB.width, selectionBB.height);
    if (tempBB.width <= 0) {
      tempBB.left += tempBB.width - 1;
      tempBB.width = -tempBB.width + 2;
    }
    if (tempBB.height <= 0) {
      tempBB.top += tempBB.height - 1;
      tempBB.height = -tempBB.height + 2;
    }
    tempBB.restrict(this.canvasBB);
    return tempBB;
  },
  
  isSelectionVisible: function() {
    var tempBB = this.getSelectionBB();
    return BoundingBoxLayerBuilder.isBBVisible(tempBB);
  },
  
  setupDetectionTimer: function() {
    var DETECT_DELAY = 200; // in ms
    this._setupTimer(this.doDetect, function() {
      return this._lastSelectionAction;
    }, DETECT_DELAY);
  },
  
  _setupTimer: function(action, lastActionGetter, delay) {
    // Schedule action() if user has been doing something, otherwise
    // run it right away
    var self = this;
    if (Date.now() - lastActionGetter.call(this) > delay) {
      // Do action right away
      action.call(this);
      action.renderTimer = undefined;
    } else {
      // Schedule
      if (action.renderTimer)
        clearTimeout(action.renderTimer);
      action.renderTimer = setTimeout(function() {
        self._setupTimer(action, lastActionGetter, delay);
      }, delay);
    }
  },
  
  _detectIntersectedBBs: function(callback, negativeCallback) {
    var selBB = this.getSelectionBB();
    var bbs = this.bbs;
    // iterate through every bounding box and do intersection
    bbs.forEach(function(bb, index) {
      if (selBB.intersect(bb)) {
        callback.call(this, bb, index);
      } else if (negativeCallback) {
        negativeCallback.call(this, bb, index);
      }
    }, this);
  },
  
  doClip: function() {
    // PDFJS objects
    var PDFImageData = PDFJS.PDFImageData;
    
    var bbDivs = this.bbDivs;
    var bbContents = this.bbContents;
    var aTextContent = [];
    var aTextContentIndex = [];
    var aGraphicsContent = [];
    var textIndex = 0;
    var combinedBoundingBox = null;
    var dependency = {
      fonts: {},
      images: {},
      clipPaths: []
    };
    this._detectIntersectedBBs(function(bb, index) {
      var bbDiv = bbDivs[index];
      var content = bbContents[bbDiv.dataset.contentIdx];
      if (content.type == BoundingBoxType.TEXT) {
        aTextContent.push({
          content: content.textContent,
          index: textIndex++,
          vertical: content.vertical,
          bb: bb
        });
      } else {
        var clipPathObject = content.clipPathObject;
        var newContent = BoundingBoxLayerBuilder.purifyContent(content);
        if (clipPathObject) {
          newContent.clipPathIndex = Utils.getObjectIndex(clipPathObject, dependency.clipPaths);
        }
        aGraphicsContent.push(newContent);
        if (combinedBoundingBox)
          combinedBoundingBox.extendBoundingBox(bb);
        else
          combinedBoundingBox = bb.clone();
        BoundingBoxLayerBuilder.analyzeDependency(content, dependency);
      }
    }, function(bb, index) {
      var bbDiv = bbDivs[index];
      var content = bbContents[bbDiv.dataset.contentIdx];
      if (content.type == BoundingBoxType.TEXT) {
        textIndex++;
      }
    });
    var aTextContentConcat = [];
    if (aTextContent.length) {
      aTextContentConcat.push(aTextContent[0].content);
      var last = aTextContent[0];
      for (var i = 1, l = aTextContent.length; i < l; i++) {
        var current = aTextContent[i];
        var concat = false;
        if (last.index + 1 === current.index) {
          var sameLine = false;
          var overlap = 0, smaller = 0;
          if (last.vertical && current.vertical) {
            overlap = Math.min(last.bb.right, current.bb.right) - Math.max(last.bb.left, current.bb.left);
            smaller = Math.min(last.bb.width, current.bb.width);
          } else if (!last.vertical && !current.vertical) {
            overlap = Math.min(last.bb.bottom, current.bb.bottom) - Math.max(last.bb.top, current.bb.top);
            smaller = Math.min(last.bb.height, current.bb.height);
          }
          sameLine = (overlap / smaller >= 0.5);
          concat = Utils.shouldConcatText(last.content, current.content, sameLine);
        }
        if (!concat) {
          aTextContentConcat.push(" ");
        } else if (concat === "dehyphen") {
          var dehyphened = Utils.dehyphenate(last.content, current.content);
          aTextContentConcat[aTextContentConcat.length - 1] = dehyphened.part1;
          current.content = dehyphened.part2;
        }
        aTextContentConcat.push(current.content);
        last = current;
      }
    }
    var deps = BoundingBoxLayerBuilder.getDependencyArray(dependency);
    // Fetch dependency data
    var depsData = {
      fonts: deps.fonts.map(function(fontName) {
        var font = this.commonObjs.get(fontName);
        if (font) {
          return font.toIR();
        }
        return null;
      }.bind(this)),
      images: deps.images.map(function(imageName) {
        var image = this.objs.get(imageName);
        if (image) {
          return PDFImageData.toIR(image, true);
        }
        return null;
      }.bind(this)),
      clipPaths: dependency.clipPaths.map(function(clipPathObject) {
        return BoundingBoxLayerBuilder.purifyContent(clipPathObject);
      }.bind(this))
    };
    var output = {
      viewport: this.viewport,
      boundingBox: combinedBoundingBox,
      dependency: deps,
      dependencyData: depsData,
      text: aTextContentConcat.join(""),
      graphics: aGraphicsContent
    };
    var inputJSON = document.getElementById("redrawJSON");
    if (inputJSON) {
      inputJSON.value = JSON.stringify(output);
      document.getElementById("redrawForm").submit();
    }
    var event = document.createEvent("CustomEvent");
    event.initCustomEvent("PDFViewerClip", true, true, JSON.stringify(output));
    window.dispatchEvent(event);
  },
  
  doDetect: function() {
    var bbDivs = this.bbDivs;
    this._detectIntersectedBBs(function(bb, index) {
      var bbDiv = bbDivs[index];
      bbDiv.classList.add("highlight");
    }, function(bb, index) {
      var bbDiv = bbDivs[index];
      bbDiv.classList.remove("highlight");
    });
  }
};

setTimeout(function() { Test.run(); }, 0);
