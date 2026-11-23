# visorjs: the packaged tree ships no node of its own — the guest's comes from
# the nodejs apk — and upstream's launchers name one under $ROOT with no PATH
# lookup. This block is inserted after the launcher's ROOT= line, and that
# hard-coded path is rewritten to $VSCODE_NODE, so a missing or too-old node
# fails here with a message instead of `not found` from a dangling path.
VSCODE_NODE="${VSCODE_SERVER_NODE:-$(command -v node 2>/dev/null)}"
if [ -z "$VSCODE_NODE" ] || [ ! -x "$VSCODE_NODE" ]; then
	echo "$0: no usable node on PATH — \`apk add nodejs\`" >&2
	echo "$0: (or point VSCODE_SERVER_NODE at one)" >&2
	exit 1
fi
_vscode_node_major="$("$VSCODE_NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [ -z "$_vscode_node_major" ]; then
	echo "$0: $VSCODE_NODE is not a working node" >&2
	exit 1
fi
if [ "$_vscode_node_major" -lt "@NODE_MAJOR@" ]; then
	echo "$0: node @NODE_MAJOR@ or newer required, $VSCODE_NODE reports $_vscode_node_major" >&2
	exit 1
fi
