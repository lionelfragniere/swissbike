import math
import pytest
from app.main import destination_point

def test_destination_point_zero_distance():
    # Test zero distance returns same point
    lat, lon = 46.5, 6.5
    res_lat, res_lon = destination_point(lat, lon, 0, 0)
    assert math.isclose(res_lat, lat, abs_tol=1e-9)
    assert math.isclose(res_lon, lon, abs_tol=1e-9)

def test_destination_point_north():
    # Test moving North (bearing 0)
    lat, lon = 0.0, 0.0
    res_lat, res_lon = destination_point(lat, lon, 111319.49, 0) # roughly 1 degree of latitude
    assert res_lat > 0.0
    assert math.isclose(res_lat, 1.0, abs_tol=1e-2)
    assert math.isclose(res_lon, 0.0, abs_tol=1e-9)

def test_destination_point_south():
    # Test moving South (bearing 180)
    lat, lon = 0.0, 0.0
    res_lat, res_lon = destination_point(lat, lon, 111319.49, 180)
    assert res_lat < 0.0
    assert math.isclose(res_lat, -1.0, abs_tol=1e-2)
    assert math.isclose(res_lon, 0.0, abs_tol=1e-9)

def test_destination_point_east():
    # Test moving East (bearing 90) on the equator
    lat, lon = 0.0, 0.0
    res_lat, res_lon = destination_point(lat, lon, 111319.49, 90)
    assert math.isclose(res_lat, 0.0, abs_tol=1e-9)
    assert res_lon > 0.0
    assert math.isclose(res_lon, 1.0, abs_tol=1e-2)

def test_destination_point_west():
    # Test moving West (bearing 270) on the equator
    lat, lon = 0.0, 0.0
    res_lat, res_lon = destination_point(lat, lon, 111319.49, 270)
    assert math.isclose(res_lat, 0.0, abs_tol=1e-9)
    assert res_lon < 0.0
    assert math.isclose(res_lon, -1.0, abs_tol=1e-2)

def test_destination_point_anti_meridian_east():
    # Test crossing the anti-meridian going East
    lat, lon = 0.0, 179.5
    res_lat, res_lon = destination_point(lat, lon, 111319.49, 90)
    # Should end up around -179.5 (or +180.5 unnormalized)
    assert math.isclose(res_lat, 0.0, abs_tol=1e-9)
    assert math.isclose(res_lon, -179.5, abs_tol=1e-2)

def test_destination_point_anti_meridian_west():
    # Test crossing the anti-meridian going West
    lat, lon = 0.0, -179.5
    res_lat, res_lon = destination_point(lat, lon, 111319.49, 270)
    # Should end up around 179.5
    assert math.isclose(res_lat, 0.0, abs_tol=1e-9)
    assert math.isclose(res_lon, 179.5, abs_tol=1e-2)
