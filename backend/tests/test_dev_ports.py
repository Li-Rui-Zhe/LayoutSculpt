import socket

from scripts.startup import port_available


def test_occupied_port_stops_launch_without_touching_owner():
    with socket.socket() as owner:
        owner.bind(("127.0.0.1", 0))
        owner.listen()
        port = owner.getsockname()[1]
        assert not port_available(port)
        assert owner.fileno() != -1
    assert port_available(port)
