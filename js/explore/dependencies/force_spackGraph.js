function draw_force_graph(areaID, adjacentAreaID) {
  // URL for data
  var url1 = ghDataDir + '/spackPackageDependents.json';
  var url2 = ghDataDir + '/spackPackageDependencies.json';
  var files = [url1, url2];
  // Converts json file into object, reformats data, and then draws graph.
  Promise.all(files.map((url) => d3.json(url))).then((values) => drawGraph(reformatData(values[0], values[1]), areaID, adjacentAreaID));

  // Draws graph
  function drawGraph(data, areaID, adjacentAreaID) {
    const graphHeader = 'Spack Package Relations';
    var stdMargin = { top: 40, right: 40, bottom: 40, left: 40 }
    const margin = { top: stdMargin.top, right: stdMargin.right / 2, bottom: stdMargin.bottom / 2, left: stdMargin.left / 2 },
      width = stdTotalWidth * 2 + 80 - margin.left - margin.right,
      height = stdTotalHeight * 2 - margin.top - margin.bottom;
    const legendRectSize = 15,
      legendSpacing = 4;
    const ringSize = (Math.min(width - margin.left - margin.right - 240, height - margin.top - margin.bottom - 40) + 4) / 2;

    // Default colors picked and used to delineate Internal and External repositories
    const colors = ['#000080', '#FFD700'];

    // Default view setting
    let currentOption = 'dependentView';
    let ACTIVE_VARIATIONS = {};

    // default for filtered package(s)
    let displayed_package = 'all';
    let member_filter = 'Both';
    let transitive_deps = false;

    const chart = d3
      .select('.' + areaID)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [-width / 2, -height / 2, width, height]);

    // add a set of checkboxes to select which packages we display

    const pkg_names = data.root_nodes.map((d) => ({name: d, id: d}));
    const pkg_selector = chart
      .append("foreignObject")
      .attr("width", 480)
      .attr("height", 500)
      .attr('y', -400)
      .attr('x', -200)
      .append("xhtml:div");

    pkg_selector
      .append('input')
      .attr('type', 'text')
      .attr('placeholder', 'Package Search..')
      .attr('id', 'pkg_search')
      .on('keyup', () => {
        const input = document.getElementById("pkg_search");
        const filter = input.value.toUpperCase();
        const div = document.getElementById("pkg_select_dropdown");
        const a = div.getElementsByTagName("option");
        for (let i = 0; i < a.length; i++) {
          txtValue = a[i].textContent || a[i].innerText;
          if (txtValue.toUpperCase().indexOf(filter) > -1) {
            a[i].style.display = "";
          } else {
            a[i].style.display = "none";
          }
        }
      })

    const pkg_dropdown = pkg_selector
      .append('select')
        .attr('id', 'pkg_select_dropdown');

    pkg_dropdown
      .selectAll('option')
      .data(pkg_names)
      .join('option')
        .attr('value', (d) => d.id)
        .text((d) => d.name);

    pkg_dropdown
      .insert('option', ':first-child')
      .attr('value', 'all')
      .attr('selected', 'selected')
      .text('all packages')

    pkg_dropdown.on('change', () => {
      d = document.getElementById("pkg_select_dropdown").value;
      if (d == 'all'){
        displayed_package = 'all'
        if (currentOption == "depView") {
          dependencies();
        }
        else {
          redraw();
        }
      }
      else {
        draw_variant_picker(d)
        redraw_for_package(d)
      }
    });

    // Constants that dictate the size of the tree generated on click
    const treeWidth = stdTotalWidth * 0.9 + 50 - margin.left - margin.right,
    treeHeight = stdTotalHeight * 2 - margin.top - margin.bottom;

    const svg = d3
    .select('.' + adjacentAreaID)
    .attr('width', treeWidth)
    .attr('height', treeHeight);

    // Should always represent the current set of nodes and links being displayed
    let nodes = data.dependent_nodes;
    let links = data.dependent_links;

    const nodeTip = d3
      .tip()
      .attr('class', 'd3-tip')
      .offset([-10, 0])
      .html(function (d) {
        return `${d.id}`;
      });

    const linkTip = d3
      .tip()
      .attr('class', 'd3-tip')
      .offset([-10, 0])
      .html(function (d) {
        if (currentOption=="depView") {
          return `${d.source.id} depends on ${d.target.id}`;
        }
        else {
          return `${d.source.id} has dependent ${d.target.id}`;
        }

      });

    chart.call(nodeTip);
    chart.call(linkTip);

    // Adds static, directional, and link forces to nodes
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink(links)
          .id((d) => d.id)
          .distance((d) => 10),
      )
      .force(
        'charge',
        d3.forceManyBody().strength(() => -20),
      )
      .force(
        'x',
        d3.forceX().strength(() => 0.14),
      )
      .force(
        'y',
        d3.forceY().strength(() => 0.14),
      );
    const newLinks = links;
    simulation.force('link').links(newLinks).distance(30);
    // Adds title
    chart
      .append('text')
      .attr('class', 'graphtitle')
      .attr('x', 0)
      .attr('y', 0 - (height / 2 - margin.top / 3))
      .attr('text-anchor', 'middle')
      .text(graphHeader);

    // Adds ring
    chart.append('circle').attr('cx', 10).attr('cy', 50).attr('r', ringSize).attr('fill', '#FFFFFF').attr('stroke', '#000000');

    // Group for links
    const link = chart.append('g').attr('transform', 'translate(20,0)').attr('stroke', '#999').attr('stroke-opacity', 0.6);
    // Group for nodes
    const node = chart.append('g').attr('transform', 'translate(20,0)').attr('stroke', '#fff').attr('stroke-width', 1.5);
    const urlParams = new URLSearchParams(window.location.search);
    const package_queried = urlParams.has('package');

    if (package_queried) {
      const package = urlParams.get('package');
      draw_variant_picker(d);
      redraw_for_package(package);
    }
    else {
      // Adds links
      link
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke-width', (d) => (100 - d.value) / 50)
        .on('mouseover', linkTip.show)
        .on('mouseout', linkTip.hide);

      // Adds nodes
      node
        .selectAll('data-group')
        .data(nodes)
        .join('circle')
        .style('cursor', 'pointer')
        .attr('r', 5)
        .attr('class', 'inGraph')
        .attr('language', (d) => d.languages)
        .attr('id', (d) => d.id)
        .attr('fill', (d) => {
          if (d.internal) {
            return colors[0];
          } else {
            return colors[1];
          }
        })
        .on('mouseover', (d) => {
          const bfsTree = getBFSTree(d, 11);
          const t = chart.transition().duration(300);
          node
            .selectAll('circle')
            .transition(t)
            .attr('fill-opacity', (n) => (n.depth != null ? Math.max(weightCurve(n.depth, 12), 0) : 0))
            .attr('stroke-opacity', (n) => (n.depth != null ? Math.max(weightCurve(n.depth, 12), 0) : 0));
          link
            .selectAll('line')
            .transition(t)
            .attr('stroke-opacity', (n) =>
              n.source.depth != null && n.target.depth != null ? Math.max(weightCurve(Math.max(n.source.depth, n.target.depth), 12), 0) : 0.1,
            );
          nodeTip.show(d);
        })
        .on('mouseout', (d) => {
          node.selectAll('circle').each((d) => (d.depth = null));
          const t = chart.transition().duration(300);
          node
            .selectAll('circle')
            .transition(t)
            .attr('fill-opacity', (d) => {
              if (document.getElementById(d['id']).getAttribute('searched')) {
                return document.getElementById(d['id']).getAttribute('searched') === 'true' ? 1 : 0.2;
              } else {
                return 1;
              }
            })
            .attr('stroke-opacity', (d) => {
              if (document.getElementById(d['id']).getAttribute('searched')) {
                return document.getElementById(d['id']).getAttribute('searched') === 'true' ? 1 : 0.2;
              } else {
                return 1;
              }
            });
          link.selectAll('line').transition(t).attr('stroke-opacity', 0.6);
          nodeTip.hide(d);
        })
        .on('click', (d) => {
          node.selectAll('circle').each((d) => {
            d['focused'] = false;
            document.getElementById(d['id']).removeAttribute('searched');
          });
          d['focused'] = true;
          node.selectAll('circle').attr('r', (d) => (d.focused ? 8 : 5));
          draw_variant_picker(d);
          redraw_for_package(d.name);
        });
    }







    // chart
    //   .append('g')
    //   .attr('class', 'labels')
    //   .selectAll('text')
    //   .data(nodes)
    //   .join('text')
    //   .attr('dx', (d) => d.cx)
    //   .attr('dy', '.35em')
    //   .text((d) => {
    //     if (d.internal) {
    //       return d.id
    //     }
    //     else {
    //       return null
    //     }
    //   })

    // Matches node and link location to where the simulation says the points should be
    simulation.on('tick', () => {
      if (displayed_package != 'all') {
        node
          .select('circle#'+displayed_package)
          .attr('x', width / 2)
          .attr('y', height / 2);
      }
      link
        .selectAll('line')
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      node
        .selectAll('circle')
        .attr('cx', (d) => d.x)
        .attr('cy', (d) => d.y);
    });

    // Data for legend
    const labels = ['Member Packages', 'External Packages'];

    // Creates legend
    const legend = chart.append('g');

    // Updates legend to any array of labels and colors
    // Arrays should be the same size
    function updateLegend(labels, color = colors) {
      legend.selectAll('g').remove();

      const legendMap = [];
      color.forEach((d, i) => {
        legendMap.push({ text: labels[i], color: d });
      });

      const legendEntries = legend
        .selectAll('g')
        .data(legendMap)
        .join('g')
        .attr('class', 'legend')
        .attr('transform', (d, i) => {
          const legendHeight = legendRectSize + legendSpacing;
          const offset = (legendHeight * colors.length) / 2;
          const horizontal = 0 - width / 2;
          const vertical = i * legendHeight - height / 2;
          return `translate(${horizontal}, ${vertical})`;
        });

      // Adds rectangle for color reference
      legendEntries
        .append('rect')
        .attr('width', legendRectSize)
        .attr('height', legendRectSize)
        .style('fill', (d) => {
          return d.color;
        })
        .style('stroke', (d) => {
          return d.color;
        });

      // Adds legend text
      legendEntries
        .append('text')
        .attr('x', legendRectSize + legendSpacing)
        .attr('y', legendRectSize - legendSpacing)
        .text((d) => {
          return d.text;
        })
        .attr('text-anchor', 'start');
    }

    updateLegend(labels)

    const transitiveButton = chart
    .append('g')
    .attr('transform', `translate(350, -382)`);

  const transitiveButtonCircle = transitiveButton
    .append('circle')
    .attr('r', legendRectSize / 2)
    .attr('cx', legendRectSize / 2)
    .attr('cy', 2 - legendRectSize / 2)
    .attr('fill', transitive_deps ? 'lightblue' : 'white')
    .attr('stroke', transitive_deps ? 'white' : 'black')
    .style('cursor', 'pointer')
    .on('click', () => {
      transitive_deps = !transitive_deps;
      if (transitive_deps) {
        transitiveButtonCircle.attr('fill', 'lightblue');
        transitiveButtonCircle.attr('stroke', 'white');
      }
      else {
        transitiveButtonCircle.attr('fill', 'white');
        transitiveButtonCircle.attr('stroke', 'black');
      }
      if (currentOption == "depView") {
        dependencies();
      }
      else {
        redraw();
      }
    });

  transitiveButton
    .append('text')
    .attr('x', legendRectSize + legendSpacing)
    .text('Show transitive deps')
    .attr('text-anchor', 'start');

    const options = {};

    // Options for graph view
    options.depView = {
      name: 'depView',
      text: 'Packages connected to dependencies',
      labels: ['Member Repositories with Dependencies', 'External Packages', 'Internal Packages'],
      languages: true,
      function: dependencies,
    };
    options.dependentView = {
      name: 'dependentView',
      text: 'Packages connected by dependents',
      labels: ['Member Repositories with Dependencies', 'External Packages', 'Internal Packages'],
      languages: true,
      function: redraw,
    };
    const optionsArray = Object.values(options);

    // Options slider
    const slider = d3
      .sliderLeft()
      .domain([0, optionsArray.length - 1])
      .step(1)
      .tickFormat((d) => {
        return optionsArray[Math.round(d)].text;
      })
      .ticks(optionsArray.length - 1)
      .height(10 * optionsArray.length - 1)
      .default(1)
      .on('onchange', (val) => {
        optionChanged(optionsArray[Math.round(val)]);
      });

    // Slider group
    chart
      .append('g')
      .attr('transform', `translate(${width / 2 - margin.right / 2},${0 - height / 2 + margin.top / 2})`)
      .call(slider);

    // What to do when the option slider is changed
    function optionChanged(o) {
      currentOption = o.name;
      options[o.name].function();
      updateLegend(options[o.name].labels);
    }

    const memberArray = ["Both", "Member", "External", ]

    const memberSlider = d3
      .sliderLeft()
      .domain([0, 2])
      .step(1)
      .tickFormat((d) => {
        return memberArray[Math.round(d)];
      })
      .ticks(2)
      .height(25)
      .on('onchange', (val) => {
        member_filter = memberArray[Math.round(val)];
        if(currentOption == "depView")
        {
          dependencies()
        }
        else {
          redraw()
        }
      });

    chart.append('g')
      .attr('transform', `translate(-450, -400)`)
      .call(memberSlider);


    // Finds all nodes and links in a certain depth and marks nodes by distance from node (not technically a tree)
    function getBFSTree(node, depth) {
      node.depth = 0;
      let nodeArray = [node];
      let linkArray = [];
      for (var i = 0; i < depth; i++) {
        linkArray = currentAdjacentEdges(nodeArray);
        nodeArray = linksToNodes(linkArray);
        nodeArray.forEach((d) => {
          d.depth = d.depth != null ? d.depth : i + 1;
        });
      }
      return { nodes: nodeArray, links: linkArray };
    }

    // Finds all edges upon which nodes in array are incident
    function adjacentEdges(nodeArray) {
      return data.links.filter((d) => nodeArray.some((o) => o.id == d.source.id) || nodeArray.some((o) => o.id == d.target.id));
    }

    // Finds all edges upon which nodes in array are incident
    function currentAdjacentEdges(nodeArray) {
      return links.filter((d) => nodeArray.some((o) => o.id == d.source.id) || nodeArray.some((o) => o.id == d.target.id));
    }

    // Converts an array of links to an array of nodes
    function linksToNodes(linkArray) {
      const nodeList = {};
      for (var l of linkArray) {
        nodeList[l.source.id] = l.source;
        nodeList[l.target.id] = l.target;
      }
      return Object.values(nodeList);
    }

    // Exponential decay curve for opacity gradient
    function weightCurve(i, max) {
      const b = 1;
      const c = Math.exp(b) / (Math.exp(max * b) - Math.exp(b));
      const a = (1 + c) * Math.exp(b);
      return a * Math.exp(0 - b * i);
    }

    // Gets the neighbors of a node using original data
    function getNeighbors(node) {
      return linksToNodes(adjacentEdges([node])).filter((d) => d.id != node.id);
    }

    // Gets the neighbors of a node in the current graph
    function getCurrentNeighbors(node) {
      return linksToNodes(currentAdjacentEdges([node])).filter((d) => d.id != node.id);
    }

    // Returns the links needed to form the complete graph on the node array
    function computeCompleteGraph(nodeArray) {
      const linkArray = [];
      for (var i = 0; i < nodeArray.length - 1; i++) {
        for (var j = i + 1; j < nodeArray.length; j++) {
          linkArray.push({ source: nodeArray[i], target: nodeArray[j], value: 1 });
        }
      }
      return linkArray;
    }

    function selectNodesLinksForPackage(nodes, links) {
      let newlinks = links;
      if (displayed_package != 'all') {
        newlinks = links.filter((d) => {
          const pkgIsSource = d.source.id == displayed_package;
          return pkgIsSource;
        })
      }
      if (!(ACTIVE_VARIATIONS === undefined || Object.keys(ACTIVE_VARIATIONS).length == 0)){
        newlinks = newlinks.filter((d)=> {
          let filter = false;
          for(var cond in ACTIVE_VARIATIONS) {
            var is_arr = Array.isArray(ACTIVE_VARIATIONS[cond]);
            if (is_arr) {
              for (var check of d.condition[cond]) {
                var filt = ACTIVE_VARIATIONS[cond].includes(check);
                if (filt) {
                  filter = true;
                }
              }
            }
            else {
              if (ACTIVE_VARIATIONS[cond] == d.condition[cond]) {
                filter = true;
              }
            }
          }
          return filter;
        })
      }
      if (transitive_deps && displayed_package != 'all') {
        allNodes = new Set(nodes.filter((d) => newlinks.some((o) => d.id == o.source.id || d.id == o.target.id)));
        tmpLinks = links.filter((d) => {
          const tmpNodeArr = Array.from(allNodes);
          return tmpNodeArr.some((o) => {
            return o.id == d.source.id || o.id == d.target.id
          })
        })
        newNodes = new Set(nodes.filter((d) => tmpLinks.some((o) => d.id == o.source.id || d.id == o.target.id)));
        while(newNodes.difference(allNodes).size) {
          allNodes = newNodes.union(allNodes);
          tmpLinks = links.filter((d) => {
            const tmpNodeArr = Array.from(allNodes)
            return tmpNodeArr.some((o) => {
              return o.id == d.source.id || o.id == d.target.id
            })
          })
          newNodes = new Set(nodes.filter((d) => tmpLinks.some((o) => d.id == o.source.id || d.id == o.target.id)));
        }
        newlinks = tmpLinks;
      }
      if (member_filter != 'Both') {
        if (member_filter == 'Member') {
          newlinks = newlinks.filter((d) => {
            member = true;
            if ((!d.source.internal) || (!d.target.internal)) {
              // always want to keep our requested package in the graph
              member = false;
            }
            return member;
          })
        }
        else {
          newlinks = newlinks.filter((d) => {
            nonmember = true;
            if ((d.source.internal) || (d.target.internal)) {
              // always want to keep our requested package in the graph
              pkgIsTarget = d.source.id == displayed_package;
              targetIsInternal = d.target.internal
              if ((!pkgIsTarget || targetIsInternal) || displayed_package == 'all') {
                nonmember = false;
              }
            }
            return nonmember;
          })
        }
      }
      nodes = nodes.filter((d) => newlinks.some((o) => d.id == o.source.id || d.id == o.target.id));
      return {
        nodes: nodes,
        links: newlinks
      }
    }

    // Switches to view where packages are connected based on dependencies. Number of links represents number of shared packages
    function dependencies() {
      newNodesLinks = selectNodesLinksForPackage(data.dependency_nodes, data.dependency_links)
      const newNodes = newNodesLinks.nodes;
      const newLinks = newNodesLinks.links;

      simulation.nodes(newNodes);
      simulation.force('link').links(newLinks).distance(30);
      simulation.force('charge').strength(-110);

      node
        .selectAll('circle')
        .data(newNodes)
        .join('circle')
        .style('cursor', 'pointer')
        .attr('r', 5)
        .attr('class', 'inGraph')
        .attr('language', (d) => d.languages)
        .attr('id', (d) => d.id)
        .attr('searched', undefined)
        .attr('fill-opacity', 1)
        .attr('stroke-opacity', 1)
        .attr('fill', (d) => {
          if (d.internal) {
            return colors[0];
          } else {
            return colors[1];
          }
        })
        .on('mouseover', (d) => {
          const bfsTree = getBFSTree(d, 11);
          const t = chart.transition().duration(300);
          node
            .selectAll('circle')
            .transition(t)
            .attr('fill-opacity', (n) => (n.depth != null ? Math.max(weightCurve(n.depth, 12), 0) : 0))
            .attr('stroke-opacity', (n) => (n.depth != null ? Math.max(weightCurve(n.depth, 12), 0) : 0));
          link
            .selectAll('line')
            .transition(t)
            .attr('stroke-opacity', (n) =>
              n.source.depth != null && n.target.depth != null
                ? Math.max(weightCurve(Math.max(n.source.depth, n.target.depth), 12) * 0.2, 0)
                : 0.05,
            );
          nodeTip.show(d);
        })
        .on('mouseout', (d) => {
          node.selectAll('circle').each((d) => (d.depth = null));
          const t = chart.transition().duration(300);
          node
            .selectAll('circle')
            .transition(t)
            .attr('fill-opacity', (d) => {
              if (document.getElementById(d['id']).getAttribute('searched')) {
                return document.getElementById(d['id']).getAttribute('searched') === 'true' ? 1 : 0.2;
              } else {
                return 1;
              }
            })
            .attr('stroke-opacity', (d) => {
              if (document.getElementById(d['id']).getAttribute('searched')) {
                return document.getElementById(d['id']).getAttribute('searched') === 'true' ? 1 : 0.2;
              } else {
                return 1;
              }
            });
          link.selectAll('line').transition(t).attr('stroke-opacity', 0.2);
          nodeTip.hide(d);
        })
        .on('click', (d) => {
          node.selectAll('circle').each((d) => {
            d['focused'] = false;
            document.getElementById(d['id']).removeAttribute('searched');
          });
          d['focused'] = true;
          node.selectAll('circle').attr('r', (d) => (d.focused ? 8 : 5));
          draw_variant_picker(d);
          redraw_for_package(d.name);
        });

      link
        .selectAll('line')
        .data(newLinks)
        .join(
          (enter) => enter.append('line'),
          (update) => update,
          (exit) => exit.remove(),
        )
        .attr('stroke-width', 2)
        .on('mouseover', linkTip.show)
        .on('mouseout', linkTip.hide);

      link.selectAll('line').attr('stroke-opacity', 0.2);

      nodes = newNodes;
      links = newLinks;

      simulation.restart().alpha(1);
    }


    function redraw_for_package(pkg) {
      displayed_package = pkg;
      tmpNodes = data.dependent_nodes;
      tmpLinks = data.dependent_links;
      if(currentOption == "depView") {
        tmpNodes = data.dependency_nodes;
        tmpLinks = data.dependency_links;
      }
      newNodesLinks = selectNodesLinksForPackage(tmpNodes, tmpLinks)
      const nodesToKeep = newNodesLinks.nodes;
      const linksToKeep = newNodesLinks.links;

      simulation.nodes(nodesToKeep);
      simulation.force('link').links(linksToKeep).distance(60);
      simulation.force('charge').strength(-110);

      node
        .selectAll('circle')
        .data(nodesToKeep)
        .join('circle')
        .style('cursor', 'pointer')
        .attr('r', 5)
        .attr('class', 'inGraph')
        .attr('language', (d) => d.languages)
        .attr('id', (d) => d.id)
        .attr('searched', undefined)
        .attr('fill-opacity', 1)
        .attr('stroke-opacity', 1)
        .attr('fill', (d) => {
          if (d.internal) {
            return colors[0];
          } else {
            return colors[1];
          }
        })
        .on('mouseover', (d) => {
          const bfsTree = getBFSTree(d, 11);
          const t = chart.transition().duration(300);
          node
            .selectAll('circle')
            .transition(t)
            .attr('fill-opacity', (n) => (n.depth != null ? Math.max(weightCurve(n.depth, 12), 0) : 0))
            .attr('stroke-opacity', (n) => (n.depth != null ? Math.max(weightCurve(n.depth, 12), 0) : 0));
          link
            .selectAll('line')
            .transition(t)
            .attr('stroke-opacity', (n) =>
              n.source.depth != null && n.target.depth != null
                ? Math.max(weightCurve(Math.max(n.source.depth, n.target.depth), 12), 0)
                : 0.1,
            );
          nodeTip.show(d);
        })
        .on('mouseout', (d) => {
          node.selectAll('circle').each((d) => (d.depth = null));
          const t = chart.transition().duration(300);
          node
            .selectAll('circle')
            .transition(t)
            .attr('fill-opacity', (d) => {
              if (document.getElementById(d['id']).getAttribute('searched')) {
                return document.getElementById(d['id']).getAttribute('searched') === 'true' ? 1 : 0.2;
              } else {
                return 1;
              }
            })
            .attr('stroke-opacity', (d) => {
              if (document.getElementById(d['id']).getAttribute('searched')) {
                return document.getElementById(d['id']).getAttribute('searched') === 'true' ? 1 : 0.2;
              } else {
                return 1;
              }
            });
          link.selectAll('line').transition(t).attr('stroke-opacity', 0.6);
          nodeTip.hide(d);
        })
        .on('click', (d) => {
          node.selectAll('circle').each((d) => {
            d['focused'] = false;
            document.getElementById(d['id']).removeAttribute('searched');
          });
          d['focused'] = true;
          node.selectAll('circle').attr('r', (d) => (d.focused ? 8 : 5));
          draw_variant_picker(d);
          redraw_for_package(d.name);
        });

      link
        .selectAll('line')
        .data(linksToKeep)
        .join(
          (enter) => enter.append('line'),
          (update) => update,
          (exit) => exit.remove(),
        )
        .attr('stroke-width', (d) => (100 - d.value) / 50)
        .attr('stroke-opacity', 0.6)
        .on('mouseover', linkTip.show)
        .on('mouseout', linkTip.hide);

      nodes = nodesToKeep;
      links = linksToKeep;

      simulation.restart().alpha(1);
    }

    // Recomputes and draws the original view
    function redraw() {
      // Uses original data to create a list of internal repos connected by shared dependencies
      newNodesLinks = selectNodesLinksForPackage(data.dependent_nodes, data.dependent_links)
      const newNodes = newNodesLinks.nodes;
      const newLinks = newNodesLinks.links;

      simulation.nodes(newNodes);
      simulation.force('link').links(newLinks).distance(30);
      simulation.force('charge').strength(-60);

      node
        .selectAll('circle')
        .data(newNodes)
        .join('circle')
        .style('cursor', 'pointer')
        .attr('r', 5)
        .attr('class', 'inGraph')
        .attr('language', (d) => d.languages)
        .attr('id', (d) => d.id)
        .attr('searched', undefined)
        .attr('fill-opacity', 1)
        .attr('stroke-opacity', 1)
        .attr('fill', (d) => {
          if (d.internal) {
            return colors[0];
          } else {
            return colors[1];
          }
        })
        .on('mouseover', (d) => {
          const bfsTree = getBFSTree(d, 11);
          const t = chart.transition().duration(300);
          node
            .selectAll('circle')
            .transition(t)
            .attr('fill-opacity', (n) => (n.depth != null ? Math.max(weightCurve(n.depth, 12), 0) : 0))
            .attr('stroke-opacity', (n) => (n.depth != null ? Math.max(weightCurve(n.depth, 12), 0) : 0));
          link
            .selectAll('line')
            .transition(t)
            .attr('stroke-opacity', (n) =>
              n.source.depth != null && n.target.depth != null
                ? Math.max(weightCurve(Math.max(n.source.depth, n.target.depth), 12), 0)
                : 0.1,
            );
          nodeTip.show(d);
        })
        .on('mouseout', (d) => {
          node.selectAll('circle').each((d) => (d.depth = null));
          const t = chart.transition().duration(300);
          node
            .selectAll('circle')
            .transition(t)
            .attr('fill-opacity', (d) => {
              if (document.getElementById(d['id']).getAttribute('searched')) {
                return document.getElementById(d['id']).getAttribute('searched') === 'true' ? 1 : 0.2;
              } else {
                return 1;
              }
            })
            .attr('stroke-opacity', (d) => {
              if (document.getElementById(d['id']).getAttribute('searched')) {
                return document.getElementById(d['id']).getAttribute('searched') === 'true' ? 1 : 0.2;
              } else {
                return 1;
              }
            });
          link.selectAll('line').transition(t).attr('stroke-opacity', 0.6);
          nodeTip.hide(d);
        })
        .on('click', (d) => {
          node.selectAll('circle').each((d) => {
            d['focused'] = false;
            document.getElementById(d['id']).removeAttribute('searched');
          });
          d['focused'] = true;
          node.selectAll('circle').attr('r', (d) => (d.focused ? 8 : 5));
          draw_variant_picker(d);
          redraw_for_package(d.name);
        });

      link
        .selectAll('line')
        .data(newLinks)
        .join(
          (enter) => enter.append('line'),
          (update) => update,
          (exit) => exit.remove(),
        )
        .attr('stroke-width', (d) => (100 - d.value) / 50)
        .attr('stroke-opacity', 0.6)
        .on('mouseover', linkTip.show)
        .on('mouseout', linkTip.hide);

      nodes = newNodes;
      links = newLinks;

      simulation.restart().alpha(1);
    }

    function draw_variant_picker(pkg) {
      ACTIVE_VARIATIONS = {}
      d3.select('.' + adjacentAreaID)
        .select('g')
        .remove();

      displayed_package = pkg;
      tmpNodes = data.dependent_nodes;
      tmpLinks = data.dependent_links;
      if(currentOption == "depView") {
        tmpNodes = data.dependency_nodes;
        tmpLinks = data.dependency_links;
      }
      if (displayed_package != 'all') {
        tmpLinks = tmpLinks.filter((d) => {
          const pkgIsSource = d.source.id == displayed_package;
          return pkgIsSource;
        })
      }
      else {
        return
      }

      let value_count = 0;
      const variant_picker = svg
        .append('g')
        .append("foreignObject")
        .attr("width", 450)
        .attr("height", 930)
        .append("xhtml:div");

      const variant_dropdown = variant_picker
        .append('select')

      variant_dropdown
        .attr('id', 'variant_picker')
        .attr('multiple', true);

      // VERSIONS
      var version_options = [];
      for (const lnk of tmpLinks) {
        version_options = version_options.concat(lnk["condition"]["versions"]);
      }
      const uniq_versions = [...new Set(version_options)];
      value_count = value_count + uniq_versions.length;

      if (uniq_versions.length > 0) {
        value_count = value_count + 1;
        const version_group = variant_dropdown
          .append("optgroup")
            .attr('label', 'versions');

        version_group
          .selectAll('option')
          .data(uniq_versions)
          .join('option')
            .attr('value', (d) => d)
            .text((d) => d);
      }

      // VARIANTS
      var variant_options = [];
      for (const lnk of tmpLinks) {
        variant_options = variant_options.concat(lnk["condition"]["variants"]);
      }
      const uniq_variants = [...new Set(variant_options)];
      value_count = value_count + uniq_variants.length;
      if (uniq_variants.length > 0) {
        value_count = value_count + 1;

        const variant_group = variant_dropdown
          .append("optgroup")
            .attr('label', 'variants');

        variant_group
          .selectAll('option')
          .data(uniq_variants)
          .join('option')
            .attr('value', (d) => d)
            .text((d) => d);
      }

      // DEPS
      var dep_options = [];
      for (var lnk of tmpLinks) {
        dep_options = dep_options.concat(lnk["condition"]["dep_flags"]);
      }
      const uniq_deps = [...new Set(dep_options)];
      value_count = value_count + uniq_deps.length;
      if (uniq_deps.length > 0) {
        value_count = value_count + 1;

        const deps_group = variant_dropdown
          .append("optgroup")
            .attr('label', 'dep-flags');

        deps_group
          .selectAll('option')
          .data(uniq_deps)
          .join('option')
            .attr('value', (d) => d)
            .text((d) => d);
      }

      // TARGETS
      const target_options = [];
      for (var lnk of tmpLinks) {
        target_options.push(lnk["condition"]["target"]);
      }
      const uniq_target = [...new Set(target_options)];
      value_count = value_count + uniq_target.length;
      if ( uniq_target.length > 0) {
        value_count = value_count + 1;

        const target_group = variant_dropdown
          .append("optgroup")
            .attr('label', 'targets');

        target_group
          .selectAll('option')
          .data(uniq_target)
          .join('option')
            .attr('value', (d) => d)
            .text((d) => d);
      }
      // PLATFORMS
      const platform_options = [];
      for (var lnk of tmpLinks) {
        platform_options.push(lnk["condition"]["platform"]);
      }
      const uniq_platforms = [...new Set(platform_options)];
      value_count = value_count + uniq_platforms.length;
      if (uniq_platforms.length > 0) {
        value_count = value_count + 1;

        const platform_group = variant_dropdown
          .append("optgroup")
            .attr('label', 'platform');

        platform_group
          .selectAll('option')
          .data(uniq_platforms)
          .join('option')
            .attr('value', (d) => d)
            .text((d) => d);
      }
      variant_dropdown.attr("size", (d) => {
        let diff = 35 - value_count;
        size = diff > 0? value_count : 35;
        return size;
      });

      variant_dropdown.on('change', () => {
        var d = document.getElementById("variant_picker");
        var selected_variations = {};
        var options = d && d.options;
        for (var i=0, iLen=options.length; i<iLen; i++) {
          opt = options[i];
          if (opt.selected) {
            selected_variations[opt.parentNode.label] = opt.value
          }
        }
        ACTIVE_VARIATIONS = selected_variations;
        if (displayed_package == 'all'){
          ACTIVE_VARIATIONS = {};
          if (currentOption == "depView") {
            dependencies();
          }
          else {
            redraw();
          }
        }
        else {
          redraw_for_package(displayed_package);
        }
      });
    }
  }

  // Converts json file to usable data
  function reformatData(obj1, obj2) {
    const dependent_nodes = [];
    const dependent_links = [];
    const dependency_nodes = [];
    const dependency_links = [];
    const root_nodes = [];
    for (var pkg in obj1) {
      if (!dependent_nodes.some((d) => d.id == pkg)) {
        dependent_nodes.push({
          name: pkg,
          id: pkg,
          internal: true,
          languages: obj1[pkg]['languages'],
        });
      }
      else {
        const root_pkg = dependent_nodes.find((d) => d.id == pkg)
        root_pkg["internal"] = true;
      }
      if (!root_nodes.some((d) => d == pkg)) {
        root_nodes.push(pkg)
      }
      for (var node in obj1[pkg]) {
        if (!dependent_nodes.some((d) => d.id == node) && node != "languages") {
          dependent_nodes.push({
            name: node,
            id: node,
            internal: false,
            languages: obj1[pkg][node]['languages'],
          });
        }
      }
      // Iterate in a follow up loop so we can populate links w/ node objects
      for (var node in obj1[pkg]) {
        if (
          !dependent_links.some(
            (d) =>
              (d.source == pkg && d.target == node) ||
              (d.source == node && d.target == pkg),
          )
          && node != "languages"
        ) {
          const tgt_node = dependent_nodes.find((d) => d.id == node);
          const source_node = dependent_nodes.find((d) => d.id == pkg);
          dependent_links.push({ source: source_node, target: tgt_node, value: 1, condition: obj1[pkg][node] });
        }
      }
    }
    for (var pkg in obj2) {
      if (!dependency_nodes.some((d) => d.id == pkg)) {
        dependency_nodes.push({
          name: pkg,
          id: pkg,
          internal: true,
          languages: obj2[pkg]['languages'],
        });
      }
      else {
        const root_pkg = dependency_nodes.find((d) => d.id == pkg)
        root_pkg["internal"] = true;
      }
      for (var node in obj2[pkg]) {
        if (!dependency_nodes.some((d) => d.id == node) && node != "languages") {
          dependency_nodes.push({
            name: node,
            id: node,
            internal: false,
            languages: obj2[pkg][node]['languages'],
          });
        }
      }
      // Iterate over the dependency nodes again to populate links w/ node objects
      for (var node in obj2[pkg]) {
        if (
          !dependency_links.some(
            (d) =>
              (d.source == pkg && d.target == node) ||
              (d.source == node && d.target == pkg),
          )
          && node != "languages"
        ) {
          const target_node = dependency_nodes.find((d) => d.id == node)
          const source_node = dependency_nodes.find((d) => d.id == pkg)
          dependency_links.push({ source: source_node, target: target_node, value: 1, condition: obj2[pkg][node] });
        }
      }
    }
    return { dependent_nodes: dependent_nodes.filter((d) => dependent_links.some((o) => d.id == o.source.id || d.id == o.target.id)), dependent_links: dependent_links,
             dependency_nodes: dependency_nodes.filter((d) => dependency_links.some((o) => d.id == o.source.id || d.id == o.target.id)), dependency_links: dependency_links,
             root_nodes: root_nodes
    };
  }
}

function searchForm(event) {
  event.preventDefault();
  $('.inGraph').attr('fill-opacity', function (i, d) {
    return $(this).attr('id').toUpperCase().includes(document.getElementById('search').value.toUpperCase()) ||
      ($(this).attr('language') && $(this).attr('language').toUpperCase().includes(document.getElementById('search').value.toUpperCase()))
      ? 1
      : 0.2;
  });

  $('.inGraph').attr('stroke-opacity', function (i, d) {
    return $(this).attr('id').toUpperCase().includes(document.getElementById('search').value.toUpperCase()) ||
      ($(this).attr('language') && $(this).attr('language').toUpperCase().includes(document.getElementById('search').value.toUpperCase()))
      ? 1
      : 0.2;
  });

  $('.inGraph').attr('r', function (i, d) {
    return $(this).attr('id').toUpperCase().includes(document.getElementById('search').value.toUpperCase()) ||
      ($(this).attr('language') && $(this).attr('language').toUpperCase().includes(document.getElementById('search').value.toUpperCase()))
      ? 6.5
      : 5;
  });

  $('.inGraph').attr('searched', function (i, d) {
    return (
      $(this).attr('id').toUpperCase().includes(document.getElementById('search').value.toUpperCase()) ||
      ($(this).attr('language') != null &&
        $(this).attr('language').toUpperCase().includes(document.getElementById('search').value.toUpperCase()))
    );
  });
}
