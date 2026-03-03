import pytest
from app.utils import resample_points

def test_resample_points_fewer_than_max():
    # Scenario 1: Fewer points than max_samples
    points = [(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)]
    max_samples = 5
    resampled = resample_points(points, max_samples)

    assert len(resampled) == 3
    assert resampled == [(0.0, 0.0, 0), (1.0, 1.0, 1), (2.0, 2.0, 2)]

def test_resample_points_exact_match():
    # Scenario 2: Exact match for max_samples
    points = [(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)]
    max_samples = 3
    resampled = resample_points(points, max_samples)

    assert len(resampled) == 3
    assert resampled == [(0.0, 0.0, 0), (1.0, 1.0, 1), (2.0, 2.0, 2)]

def test_resample_points_general_case():
    # Scenario 3: General case where points > max_samples
    points = [(float(i), float(i)) for i in range(10)]
    max_samples = 5
    resampled = resample_points(points, max_samples)

    assert len(resampled) == 5
    assert resampled[0] == (0.0, 0.0, 0)
    assert resampled[-1] == (9.0, 9.0, 9)
    assert [x[2] for x in resampled] == [0, 2, 4, 7, 9]

def test_resample_points_large_array():
    # Scenario 4: Large array
    points = [(float(i), float(i)) for i in range(1000)]
    max_samples = 100
    resampled = resample_points(points, max_samples)

    assert len(resampled) == 100
    assert resampled[0] == (0.0, 0.0, 0)
    assert resampled[-1] == (999.0, 999.0, 999)
    # Ensure they are monotonically increasing
    indices = [x[2] for x in resampled]
    assert indices == sorted(indices)
    assert len(set(indices)) == 100 # All distinct

def test_resample_points_rounding_edge_case():
    # Scenario 5: Step rounding edge cases
    points = [(float(i), float(i)) for i in range(11)] # length 11
    max_samples = 4
    resampled = resample_points(points, max_samples)
    assert len(resampled) == 4
    assert resampled[0] == (0.0, 0.0, 0)
    assert resampled[1] == (3.0, 3.0, 3)
    assert resampled[2] == (7.0, 7.0, 7)
    assert resampled[-1] == (10.0, 10.0, 10)


def test_resample_points_last_point_enforcement_mock(monkeypatch):
    """
    Test last point enforcement:

    # Let's find a case where round() produces an index slightly less than len-1
    # step=(len(latlons)-1)/(max_samples-1)
    # the last index is computed as: int(round((max_samples-1)*step))
    # which is exactly: int(round((max_samples-1) * (len(latlons)-1) / (max_samples-1)))
    # which is exactly len(latlons)-1
    # Mathematically, the only way it doesn't hit len(latlons)-1 is floating point drift,
    # or if we provide a list where step causes round to be lower.
    """
    import app.utils
    original_round = round
    def mock_round(n):
        return 0 # Force all indices to 0

    monkeypatch.setattr('builtins.round', mock_round)

    points = [(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)]
    resampled = app.utils.resample_points(points, max_samples=2)

    # max_samples=2, len=3. step=2.0
    # i=0: round(0) -> 0. out=[(0.0, 0.0, 0)]
    # i=1: round(2) -> mock -> 0. out=[(0.0, 0.0, 0), (0.0, 0.0, 0)]
    # out[-1][2] is 0 != len(points)-1 (which is 2)
    # So lines 28-29 trigger and out[-1] becomes (2.0, 2.0, 2).

    assert len(resampled) == 2
    assert resampled[-1] == (2.0, 2.0, 2)
    assert resampled[0] == (0.0, 0.0, 0)
