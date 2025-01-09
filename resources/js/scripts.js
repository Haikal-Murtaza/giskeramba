// Konversi bounds ke EPSG:3857
const bounds = ol.proj.transformExtent(
    [97.1330, 5.1700, 97.1400, 5.1750],
    'EPSG:4326',
    'EPSG:3857'
);

// Inisialisasi View Map
var mapview = new ol.View({
    center: ol.proj.fromLonLat([97.13786, 5.17186]),
    zoom: 15,
    extent: bounds,
});

// Inisialisasi Peta
var map = new ol.Map({
    target: 'map',
    view: mapview,
});

// Pembatas extent
map.getView().on('change:center', function () {
    const view = map.getView();
    const center = view.getCenter();
    if (!ol.extent.containsCoordinate(bounds, center)) {
        view.setCenter(ol.extent.getCenter(bounds));
    }
});

// Layer Dasar
var osmLayer = new ol.layer.Tile({
    title: 'Open Street Map',
    source: new ol.source.OSM(),
    visible: true,
});

var googleSatLayer = new ol.layer.Tile({
    title: 'Google Satellite',
    visible: false,
    source: new ol.source.XYZ({
        url: 'http://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        maxZoom: 20,
    }),
});

// Group Layer Dasar
var baseGroup = new ol.layer.Group({
    title: 'Base Maps',
    layers: [osmLayer, googleSatLayer],
});

map.addLayer(baseGroup);

// LayerSwitcher
var layerSwitcher = new ol.control.LayerSwitcher({
    activationMode: 'click',
    startActive: false,
    groupSelectStyle: 'children',
});
map.addControl(layerSwitcher);

// Popup
var container = document.getElementById('popup');
var content = document.getElementById('popup-content');
var closer = document.getElementById('popup-closer');

var popup = new ol.Overlay({
    element: container,
    autoPan: true,
    autoPanAnimation: { duration: 250 },
});

map.addOverlay(popup);

closer.onclick = function () {
    popup.setPosition(undefined);
    closer.blur();
    return false;
};

// Layer Polygon dari GeoServer untuk Keramba
var kerambaLayer = new ol.layer.Tile({
    title: 'Keramba',
    source: new ol.source.TileWMS({
        url: 'http://localhost:8080/geoserver/gismongeudong/wms',
        params: { 'LAYERS': 'gismongeudong:keramba', 'TILED': true },
        serverType: 'geoserver',
    }),
});

map.addLayer(kerambaLayer);

// Handle Klik Popup untuk Data
map.on('singleclick', function (evt) {
    content.innerHTML = '';
    var resolution = map.getView().getResolution();
    var kerambaUrl = kerambaLayer.getSource().getFeatureInfoUrl(
        evt.coordinate,
        resolution,
        'EPSG:3857',
        { INFO_FORMAT: 'application/json' }
    );

    if (kerambaUrl) {
        $.getJSON(kerambaUrl, function (data) {
            if (data.features.length > 0) {
                var props = data.features[0].properties;
                var popupContent = `
                    <h3>Nama Pemilik: ${props.nm_pmlk || 'N/A'}</h3>
                    <p>No Telp: ${props.no_tlp || 'N/A'}</p>
                    <p>Jenis Ikan: ${props.jenis_ikn || 'N/A'}</p>
                    <p>Status Usaha: ${props.stat_usaha || 'N/A'}</p>
                    <p>Luas: ${props.luas || 'N/A'}</p>
                `;
                content.innerHTML = popupContent;
                popup.setPosition(evt.coordinate);
            }
        });
    }
});

var defaultLayer = "gismongeudong:keramba";

$(document).ready(function () {
    // Muat atribut dari layer default
    loadAttributes(defaultLayer);

    // Dropdown Atribut
    function loadAttributes(layerName) {
        var attributes = document.getElementById("attributes");
        attributes.options.length = 0;
        attributes.options[0] = new Option('Select attributes', "");

        $.ajax({
            type: "GET",
            url: `http://localhost:8080/geoserver/gismongeudong/wfs?service=WFS&request=DescribeFeatureType&version=1.1.0&typeName=${layerName}`,
            dataType: "xml",
            success: function (xml) {
                var select = $('#attributes');
                $(xml).find('xsd\\:element').each(function () {
                    var value = $(this).attr('name');
                    var type = $(this).attr('type');
                    if (value !== 'geom' && value !== 'the_geom') {
                        select.append(`<option value="${type}">${value}</option>`);
                    }
                });
            }
        });
    }

    // Dropdown Operator
    $("#attributes").change(function () {
        var operator = document.getElementById("operator");
        operator.options.length = 0;
        var value_type = $(this).val();
        operator.options[0] = new Option('Select operator', "");

        if (value_type === 'xsd:short' || value_type === 'xsd:int' || value_type === 'xsd:double') {
            operator.options[1] = new Option('Greater than', '>');
            operator.options[2] = new Option('Less than', '<');
            operator.options[3] = new Option('Equal to', '=');
        } else if (value_type === 'xsd:string') {
            operator.options[1] = new Option('Like', 'ILike');
        }
    });

    // Highlight Style
    var highlightStyle = new ol.style.Style({
        fill: new ol.style.Fill({
            color: 'rgba(255,255,255,0.7)',
        }),
        stroke: new ol.style.Stroke({
            color: '#3399CC',
            width: 3,
        }),
        image: new ol.style.Circle({
            radius: 10,
            fill: new ol.style.Fill({
                color: '#3399CC'
            })
        })
    });

    featureOverlay = new ol.layer.Vector({
        source: new ol.source.Vector(),
        map: map,
        style: highlightStyle
    });
});

var geojson = null;

function query() {
    $('#table').empty();
    if (geojson) {
        map.removeLayer(geojson);
    }

    if (featureOverlay) {
        featureOverlay.getSource().clear();
        map.removeLayer(featureOverlay);
    }

    var attribute = document.getElementById("attributes");
    var value_attribute = attribute.options[attribute.selectedIndex].text;

    var operator = document.getElementById("operator");
    var value_operator = operator.options[operator.selectedIndex].value;

    var txt = document.getElementById("value");
    var value_txt = txt.value;

    if (!value_attribute || !value_operator || !value_txt) {
        alert("Please fill all fields before running the query.");
        return; // Menghentikan eksekusi jika ada input kosong
    }

    var url = `http://localhost:8080/geoserver/gismongeudong/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${defaultLayer}&CQL_FILTER=${value_attribute}+${value_operator}+'${value_txt}'&outputFormat=application/json`;

    var style = new ol.style.Style({
        fill: new ol.style.Fill({
            color: 'rgba(255, 255, 255, 0.7)',
        }),
        stroke: new ol.style.Stroke({
            color: '#ffcc33',
            width: 3,
        }),
        image: new ol.style.Circle({
            radius: 7,
            fill: new ol.style.Fill({
                color: '#ffcc33',
            }),
        }),
    });

    geojson = new ol.layer.Vector({
        source: new ol.source.Vector({
            url: url,
            format: new ol.format.GeoJSON(),
        }),
        style: style,
    });

    geojson.getSource().on('addfeature', function () {
        map.getView().fit(geojson.getSource().getExtent(), {
            duration: 1590,
            size: map.getSize(),
        });
    });

    map.addLayer(geojson);

    $.getJSON(url, function (data) {
        var col = [];
        col.push('id');
        for (var i = 0; i < data.features.length; i++) {
            for (var key in data.features[i].properties) {
                if (col.indexOf(key) === -1) {
                    col.push(key);
                }
            }
        }

        var table = document.createElement("table");
        table.setAttribute("class", "table table-bordered");
        table.setAttribute("id", "table");

        var tr = table.insertRow(-1);
        for (var i = 0; i < col.length; i++) {
            var th = document.createElement("th");
            th.innerHTML = col[i];
            tr.appendChild(th);
        }

        for (var i = 0; i < data.features.length; i++) {
            tr = table.insertRow(-1);
            for (var j = 0; j < col.length; j++) {
                var tabCell = tr.insertCell(-1);
                tabCell.innerHTML =
                    j === 0
                        ? data.features[i]['id']
                        : data.features[i].properties[col[j]];
            }
        }

        var divContainer = document.getElementById("table_data");
        divContainer.innerHTML = "";
        divContainer.appendChild(table);

        map.updateSize();
    });
}
